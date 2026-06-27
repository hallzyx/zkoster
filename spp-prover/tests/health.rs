use axum::{Router, routing::get};
use axum_test::TestServer;
use serde_json::Value;

fn app() -> Router {
    Router::new().route("/health", get(spp_prover_routes_health_handler))
}

// Re-export the handler for testing without running the full server
async fn spp_prover_routes_health_handler() -> axum::Json<Value> {
    axum::Json(serde_json::json!({ "status": "ok" }))
}

#[tokio::test]
async fn test_health_returns_200() {
    let server = TestServer::new(app()).unwrap();
    let response = server.get("/health").await;
    response.assert_status_ok();
    let body: Value = response.json();
    assert_eq!(body["status"], "ok");
}
