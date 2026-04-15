use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;

/// LRU page render cache
/// Stores rendered page images keyed by (page_index, scale, dark_mode_profile)
pub struct PageCache {
    cache: Arc<Mutex<HashMap<PageCacheKey, CachedPage>>>,
    max_entries: usize,
    access_order: Arc<Mutex<Vec<PageCacheKey>>>,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct PageCacheKey {
    pub page_index: usize,
    pub scale_percent: u32, // scale * 100 as integer for hashing
    pub dark_mode: u8,
}

#[derive(Clone)]
pub struct CachedPage {
    pub width: u32,
    pub height: u32,
    pub rgba_data: Vec<u8>,
}

impl PageCache {
    pub fn new(max_entries: usize) -> Self {
        Self {
            cache: Arc::new(Mutex::new(HashMap::new())),
            max_entries,
            access_order: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Get a cached page image, if available
    pub fn get(&self, key: &PageCacheKey) -> Option<CachedPage> {
        let cache = self.cache.lock();
        if let Some(page) = cache.get(key) {
            // Move to end of access order (most recently used)
            let mut order = self.access_order.lock();
            order.retain(|k| k != key);
            order.push(key.clone());
            Some(page.clone())
        } else {
            None
        }
    }

    /// Insert a rendered page into the cache
    pub fn insert(&self, key: PageCacheKey, page: CachedPage) {
        let mut cache = self.cache.lock();
        let mut order = self.access_order.lock();

        // Evict LRU entries if at capacity
        while cache.len() >= self.max_entries {
            if let Some(oldest_key) = order.first().cloned() {
                cache.remove(&oldest_key);
                order.remove(0);
            } else {
                break;
            }
        }

        order.retain(|k| k != &key);
        order.push(key.clone());
        cache.insert(key, page);
    }

    /// Clear the entire cache
    pub fn clear(&self) {
        self.cache.lock().clear();
        self.access_order.lock().clear();
    }
}
