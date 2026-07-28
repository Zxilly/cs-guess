use std::{env, net::SocketAddr, path::PathBuf, time::Duration};

use http::{HeaderValue, Uri};

use crate::error::AppError;

#[derive(Clone, Debug)]
pub struct Config {
    pub bind_addr: SocketAddr,
    pub public_base_url: String,
    pub allowed_origins: Vec<HeaderValue>,
    pub max_rooms: usize,
    pub quick_request_ttl: Duration,
    pub max_quick_request_results: usize,
    pub room_idle_timeout: Duration,
    pub reconnect_grace: Duration,
    pub disconnect_forfeit: Duration,
    pub round_transition: Duration,
    pub heartbeat_interval: Duration,
    pub client_timeout: Duration,
    pub queue_broadcast_interval: Duration,
    pub ws_queue_capacity: usize,
    pub room_queue_capacity: usize,
    pub http_concurrency_limit: usize,
    pub max_websocket_connections: usize,
    pub session_rate_capacity: usize,
    pub session_rate_refill_per_second: usize,
    pub database_path: PathBuf,
    pub database_max_connections: u32,
    pub static_dir: PathBuf,
}

impl Config {
    pub fn from_env() -> Result<Self, AppError> {
        dotenvy::dotenv().ok();

        let bind_addr = env_value("CS_GUESS_BIND_ADDR", "127.0.0.1:8080")
            .parse()
            .map_err(|error| AppError::Config(format!("invalid bind address: {error}")))?;
        let public_base_url = env_value("CS_GUESS_PUBLIC_BASE_URL", "http://127.0.0.1:8080");
        public_base_url
            .parse::<Uri>()
            .map_err(|error| AppError::Config(format!("invalid public base URL: {error}")))?;

        let allowed_origins = env_value(
            "CS_GUESS_ALLOWED_ORIGINS",
            "http://127.0.0.1:5173,http://localhost:5173",
        )
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            HeaderValue::from_str(value)
                .map_err(|error| AppError::Config(format!("invalid CORS origin: {error}")))
        })
        .collect::<Result<Vec<_>, _>>()?;

        Ok(Self {
            bind_addr,
            public_base_url: public_base_url.trim_end_matches('/').to_owned(),
            allowed_origins,
            max_rooms: parse_usize("CS_GUESS_MAX_ROOMS", 10_000)?,
            quick_request_ttl: Duration::from_secs(parse_nonzero_u64(
                "CS_GUESS_QUICK_REQUEST_TTL_SECS",
                900,
            )?),
            max_quick_request_results: parse_usize("CS_GUESS_MAX_QUICK_REQUEST_RESULTS", 20_000)?
                .max(1),
            room_idle_timeout: Duration::from_secs(parse_u64("CS_GUESS_ROOM_IDLE_SECS", 1_800)?),
            reconnect_grace: Duration::from_secs(parse_u64("CS_GUESS_RECONNECT_SECS", 120)?),
            disconnect_forfeit: Duration::from_secs(parse_u64(
                "CS_GUESS_DISCONNECT_FORFEIT_SECS",
                30,
            )?),
            round_transition: Duration::from_secs(parse_u64("CS_GUESS_ROUND_TRANSITION_SECS", 5)?),
            heartbeat_interval: Duration::from_secs(parse_u64("CS_GUESS_HEARTBEAT_SECS", 15)?),
            client_timeout: Duration::from_secs(parse_u64("CS_GUESS_CLIENT_TIMEOUT_SECS", 45)?),
            queue_broadcast_interval: Duration::from_millis(parse_nonzero_u64(
                "CS_GUESS_QUEUE_BROADCAST_MS",
                1_000,
            )?),
            ws_queue_capacity: parse_usize("CS_GUESS_WS_QUEUE_CAPACITY", 64)?,
            room_queue_capacity: parse_usize("CS_GUESS_ROOM_QUEUE_CAPACITY", 256)?,
            http_concurrency_limit: parse_usize("CS_GUESS_HTTP_CONCURRENCY_LIMIT", 512)?,
            max_websocket_connections: parse_usize("CS_GUESS_MAX_WEBSOCKET_CONNECTIONS", 20_000)?,
            session_rate_capacity: parse_usize("CS_GUESS_SESSION_RATE_CAPACITY", 1_000)?,
            session_rate_refill_per_second: parse_usize(
                "CS_GUESS_SESSION_RATE_REFILL_PER_SECOND",
                250,
            )?,
            database_path: PathBuf::from(env_value(
                "CS_GUESS_DATABASE_PATH",
                "data/cs-guess.sqlite",
            )),
            database_max_connections: parse_nonzero_u32("CS_GUESS_DATABASE_MAX_CONNECTIONS", 8)?,
            static_dir: PathBuf::from(env_value("CS_GUESS_STATIC_DIR", "../dist")),
        })
    }

    pub fn for_test() -> Self {
        Self {
            bind_addr: "127.0.0.1:0".parse().expect("test address is valid"),
            public_base_url: "http://localhost".to_owned(),
            allowed_origins: vec![HeaderValue::from_static("http://localhost")],
            max_rooms: 2_000,
            quick_request_ttl: Duration::from_secs(60),
            max_quick_request_results: 4_000,
            room_idle_timeout: Duration::from_secs(60),
            reconnect_grace: Duration::from_secs(10),
            disconnect_forfeit: Duration::from_secs(10),
            round_transition: Duration::from_millis(20),
            heartbeat_interval: Duration::from_secs(1),
            client_timeout: Duration::from_secs(3),
            queue_broadcast_interval: Duration::from_millis(25),
            ws_queue_capacity: 16,
            room_queue_capacity: 64,
            http_concurrency_limit: 32,
            max_websocket_connections: 256,
            session_rate_capacity: 10_000,
            session_rate_refill_per_second: 10_000,
            database_path: PathBuf::from(":memory:"),
            database_max_connections: 1,
            static_dir: PathBuf::from("__missing_cs_guess_static__"),
        }
    }
}

fn env_value(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_owned())
}

fn parse_usize(name: &str, default: usize) -> Result<usize, AppError> {
    env::var(name)
        .map(|value| value.parse())
        .unwrap_or(Ok(default))
        .map_err(|error| AppError::Config(format!("invalid {name}: {error}")))
}

fn parse_u64(name: &str, default: u64) -> Result<u64, AppError> {
    env::var(name)
        .map(|value| value.parse())
        .unwrap_or(Ok(default))
        .map_err(|error| AppError::Config(format!("invalid {name}: {error}")))
}

fn parse_nonzero_u32(name: &str, default: u32) -> Result<u32, AppError> {
    let value = env::var(name)
        .map(|raw| raw.parse())
        .unwrap_or(Ok(default))
        .map_err(|error| AppError::Config(format!("invalid {name}: {error}")))?;
    if value == 0 {
        Err(AppError::Config(format!("{name} must be greater than 0")))
    } else {
        Ok(value)
    }
}

fn parse_nonzero_u64(name: &str, default: u64) -> Result<u64, AppError> {
    let value = parse_u64(name, default)?;
    if value == 0 {
        Err(AppError::Config(format!("{name} must be greater than 0")))
    } else {
        Ok(value)
    }
}
