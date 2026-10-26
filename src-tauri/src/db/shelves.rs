use crate::db::Database;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Shelf {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateShelf {
    pub name: String,
}

impl Database {
    pub fn create_shelf(&self, name: &str) -> Result<Shelf, AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("INSERT INTO shelves (name) VALUES (?1)", [name])?;
        let id = conn.last_insert_rowid();
        conn.prepare("SELECT id, name, created_at FROM shelves WHERE id = ?1")?
            .query_row([id], |row| {
                Ok(Shelf {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                })
            })
            .map_err(AppError::from)
    }

    pub fn list_shelves(&self) -> Result<Vec<Shelf>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, created_at FROM shelves ORDER BY name")?;
        let shelves = stmt
            .query_map([], |row| {
                Ok(Shelf {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(shelves)
    }

    pub fn rename_shelf(&self, id: i64, new_name: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE shelves SET name = ?1 WHERE id = ?2",
            rusqlite::params![new_name, id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Shelf {id} not found")));
        }
        Ok(())
    }

    pub fn delete_shelf(&self, id: i64) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        // Books in this shelf get shelf_id = NULL (ON DELETE SET NULL)
        let changed = conn.execute("DELETE FROM shelves WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Shelf {id} not found")));
        }
        Ok(())
    }
}
