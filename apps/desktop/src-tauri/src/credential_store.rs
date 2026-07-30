use std::sync::Arc;

pub const TOKEN_KEY: &str = "sync-jwt";
const SERVICE_NAME: &str = "cn.yhdm.xiangqi-assistant";

pub trait CredentialStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

pub type SharedCredentialStore = Arc<dyn CredentialStore>;

pub struct SystemCredentialStore;

impl SystemCredentialStore {
    fn entry(key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE_NAME, key)
            .map_err(|error| format!("无法访问系统钥匙串：{error}"))
    }
}

impl CredentialStore for SystemCredentialStore {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        match Self::entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(format!("读取系统钥匙串失败：{error}")),
        }
    }

    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        Self::entry(key)?
            .set_password(value)
            .map_err(|error| format!("写入系统钥匙串失败：{error}"))
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        match Self::entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("清理系统钥匙串失败：{error}")),
        }
    }
}

#[cfg(test)]
pub struct MemoryCredentialStore(std::sync::Mutex<std::collections::HashMap<String, String>>);

#[cfg(test)]
impl MemoryCredentialStore {
    pub fn new() -> Self {
        Self(std::sync::Mutex::new(std::collections::HashMap::new()))
    }
}

#[cfg(test)]
impl CredentialStore for MemoryCredentialStore {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| "credential lock poisoned")?
            .get(key)
            .cloned())
    }

    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "credential lock poisoned")?
            .insert(key.into(), value.into());
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "credential lock poisoned")?
            .remove(key);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_adapter_supports_login_and_logout_without_persistence() {
        let store = MemoryCredentialStore::new();
        assert_eq!(store.get(TOKEN_KEY).unwrap(), None);
        store.set(TOKEN_KEY, "secret-token").unwrap();
        assert_eq!(
            store.get(TOKEN_KEY).unwrap().as_deref(),
            Some("secret-token")
        );
        store.delete(TOKEN_KEY).unwrap();
        assert_eq!(store.get(TOKEN_KEY).unwrap(), None);
    }
}
