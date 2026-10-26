use rusqlite::Connection;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

mod books;
mod chapters;
mod highlights;
mod notes;
mod settings;
mod shelves;
mod words;

pub use books::*;
pub use chapters::*;
pub use highlights::*;
pub use notes::*;
pub use shelves::*;
pub use words::*;

/// Wrapper around an SQLite connection protected by a Mutex for thread safety.
pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    /// Open (or create) the database at the given path and run migrations.
    pub fn open(db_path: &Path) -> Result<Self, rusqlite::Error> {
        // Ensure the parent directory exists
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(db_path)?;

        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        // Enable foreign keys
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;

        // Run migrations
        Self::run_migrations(&conn)?;

        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    /// Run all SQL migration files in order.
    fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
        // Create a migrations tracking table
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )?;

        // Load and apply migration files
        let migration_sql = include_str!("../../migrations/0001_init.sql");

        let already_applied: bool = conn
            .prepare("SELECT COUNT(*) FROM _migrations WHERE name = ?1")?
            .query_row(["0001_init"], |row| row.get::<_, i64>(0))
            .map(|count| count > 0)?;

        if !already_applied {
            conn.execute_batch(migration_sql)?;
            conn.execute("INSERT INTO _migrations (name) VALUES (?1)", ["0001_init"])?;
        }

        Ok(())
    }
}
