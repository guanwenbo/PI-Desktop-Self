//! Model-facing cross-session introspection (dsh `session_search`): the
//! `SessionSearch` tool lets the agent find earlier conversations in the
//! calling session's project instead of redoing completed work. Read-only;
//! it reuses the desktop global-search projection, scoped to the project.

use super::{rpc_err, AppState, JsonRpcError};
use crate::{
    session_search, sessions,
    tools::{ToolsExecuteParams, ToolsExecuteResult},
};
use serde_json::{json, Value};

const DEFAULT_LIMIT: i64 = 8;
const MAX_LIMIT: i64 = 20;
/// Over-fetch so project filtering can still fill the requested page.
const FETCH_LIMIT: i64 = 100;

pub fn recognizes(name: &str) -> bool {
    name == "SessionSearch"
}

pub fn definitions() -> Vec<Value> {
    vec![json!({
        "name": "SessionSearch",
        "description": "Search past conversations in the calling session's project.",
        "risk": "low",
        "parameters": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "query": {"type": "string", "minLength": 1, "maxLength": 500},
                "limit": {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT}
            },
            "required": ["query"]
        }
    })]
}

fn invalid(message: &str) -> JsonRpcError {
    rpc_err(1002, message, "INVALID_PARAMS")
}

fn execute_inner(st: &AppState, p: &ToolsExecuteParams) -> Result<Value, JsonRpcError> {
    let summary = sessions::session_summary(&st.db, &p.session_id)
        .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
        .ok_or_else(|| rpc_err(1007, "session not found", "SESSION_NOT_FOUND"))?;
    if sessions::session_mode(&st.db, &p.session_id)
        .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
        .as_deref()
        != Some("agent")
    {
        return Err(rpc_err(
            1002,
            "SessionSearch requires Agent mode",
            "TOOL_DISABLED_IN_PLAN",
        ));
    }
    let args = p
        .args
        .as_object()
        .ok_or_else(|| invalid("arguments must be an object"))?;
    if args.keys().any(|key| key != "query" && key != "limit") {
        return Err(invalid("unsupported SessionSearch field"));
    }
    let query = args
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("query required"))?;
    let limit = match args.get("limit") {
        Some(value) => value
            .as_i64()
            .ok_or_else(|| invalid("limit must be an integer"))?
            .clamp(1, MAX_LIMIT),
        None => DEFAULT_LIMIT,
    };
    let page = session_search::search(&st.db, query, 0, FETCH_LIMIT)
        .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
    let workspace = summary.project_path;
    let hits: Vec<Value> = page
        .hits
        .into_iter()
        .filter(|hit| hit.session.project_path == workspace)
        .take(limit as usize)
        .map(|hit| {
            json!({
                "sessionId": hit.session.id,
                "title": hit.session.title,
                "updatedAt": hit.session.updated_at,
                "current": hit.session.id == p.session_id,
                "matches": hit.matches.iter().map(|m| json!({
                    "role": m.role,
                    "createdAt": m.created_at,
                    "snippet": m.snippet,
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    Ok(json!({ "query": query, "hits": hits }))
}

pub fn execute(st: &AppState, p: &ToolsExecuteParams) -> ToolsExecuteResult {
    let started = std::time::Instant::now();
    let result = execute_inner(st, p);
    let (ok, content, error_code) = match result {
        Ok(content) => (true, content, None),
        Err(error) => {
            let code = error
                .data
                .as_ref()
                .and_then(|data| data["errorCode"].as_str())
                .unwrap_or("INTERNAL")
                .to_string();
            (
                false,
                json!({"error":error.message,"code":code}),
                Some(code),
            )
        }
    };
    ToolsExecuteResult {
        tool_call_id: p.tool_call_id.clone(),
        ok,
        is_error: (!ok).then_some(true),
        content,
        duration_ms: started.elapsed().as_millis() as u64,
        denied: None,
        error_code,
        command_shell_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::{mpsc, Mutex};

    fn insert_message(st: &AppState, session_id: &str, id: &str, seq: i64, role: &str, text: &str) {
        st.db
            .conn()
            .execute(
                "INSERT INTO messages (id, session_id, seq, role, text, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![id, session_id, seq, role, text, crate::db::now_ms()],
            )
            .unwrap();
    }

    async fn call(state: &Arc<Mutex<AppState>>, session: &str, args: Value) -> Value {
        super::super::handle_request(
            state.clone(),
            "tools.execute",
            json!({
                "sessionId":session,
                "toolCallId":uuid::Uuid::new_v4().to_string(),
                "toolName":"SessionSearch","args":args,"mode":"agent"
            }),
            mpsc::unbounded_channel().0,
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn session_search_finds_project_messages_and_marks_current() {
        let dir = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let other_project = tempfile::tempdir().unwrap();
        let mut st = AppState::open(dir.path()).unwrap();
        st.handshook = true;
        st.db
            .set_setting("app", &json!({"defaultPermissionMode":"auto"}))
            .unwrap();
        let path =
            crate::db::canonical_project_path(&st.workspace.set(project.path()).path).unwrap();
        let other_path = st.workspace.set(other_project.path()).path;
        let current = sessions::create_session(
            &st.db,
            None,
            Some("agent".into()),
            None,
            None,
            Some(path.clone()),
        )
        .unwrap();
        let past = sessions::create_session(
            &st.db,
            None,
            Some("agent".into()),
            None,
            None,
            Some(path.clone()),
        )
        .unwrap();
        let foreign = sessions::create_session(
            &st.db,
            None,
            Some("agent".into()),
            None,
            None,
            Some(other_path),
        )
        .unwrap();
        insert_message(
            &st,
            &past.id,
            "m1",
            1,
            "user",
            "how do we prune oversized tool results",
        );
        insert_message(
            &st,
            &past.id,
            "m2",
            2,
            "assistant",
            "use a model-free pruner with head and tail",
        );
        insert_message(
            &st,
            &foreign.id,
            "m3",
            1,
            "user",
            "prune everything in another project",
        );
        insert_message(
            &st,
            &current.id,
            "m4",
            1,
            "user",
            "prune my own history too",
        );
        let state = Arc::new(Mutex::new(st));

        let found = call(&state, &current.id, json!({"query":"prune"})).await;
        assert_eq!(found["ok"], true, "{found}");
        let hits = found["content"]["hits"].as_array().unwrap();
        let ids: Vec<&str> = hits
            .iter()
            .map(|hit| hit["sessionId"].as_str().unwrap())
            .collect();
        assert!(ids.contains(&past.id.as_str()), "{hits:?}");
        assert!(ids.contains(&current.id.as_str()), "{hits:?}");
        assert!(!ids.contains(&foreign.id.as_str()), "{hits:?}");
        let past_hit = hits.iter().find(|hit| hit["sessionId"] == past.id).unwrap();
        assert_eq!(past_hit["current"], false);
        assert!(
            past_hit["matches"]
                .as_array()
                .unwrap()
                .iter()
                .any(|m| m["snippet"].as_str().unwrap().contains("prune")),
            "{past_hit}"
        );

        // Non-agent sessions and bad params are refused.
        let plan = sessions::create_session(
            &state.lock().await.db,
            None,
            Some("plan".into()),
            None,
            None,
            Some(path.clone()),
        )
        .unwrap();
        let denied = call(&state, &plan.id, json!({"query":"prune"})).await;
        assert_eq!(denied["errorCode"], "TOOL_DISABLED_IN_PLAN", "{denied}");
        let empty = call(&state, &current.id, json!({"query":"  "})).await;
        assert_eq!(empty["errorCode"], "INVALID_PARAMS", "{empty}");
        let unknown = call(
            &state,
            &current.id,
            json!({"query":"x","workspacePath":"y"}),
        )
        .await;
        assert_eq!(unknown["errorCode"], "INVALID_PARAMS", "{unknown}");
    }
}
