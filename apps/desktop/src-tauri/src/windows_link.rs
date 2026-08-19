//! Windows-only capture helpers for a selected browser window.
//!
//! The old implementation started a PowerShell process for every frame and
//! copied the whole virtual desktop.  This module intentionally works from an
//! HWND client area in physical pixels, so link geometry and injected clicks
//! share one coordinate space under 100% and 125% display scaling.

use image::{DynamicImage, ImageFormat, RgbaImage};
use std::{ffi::c_void, io::Cursor, mem::size_of};
use windows_sys::Win32::{
    Foundation::{CloseHandle, BOOL, HANDLE, HWND, LPARAM, POINT, RECT},
    Graphics::Gdi::{
        BitBlt, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
        GetDC, GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, SRCCOPY,
    },
    Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
    System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW,
        PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::{
        HiDpi::GetDpiForWindow,
        Input::KeyboardAndMouse::{mouse_event, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP},
        WindowsAndMessaging::{
            EnumWindows, GetClientRect, GetWindowTextLengthW, GetWindowTextW,
            GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SetCursorPos,
            SetForegroundWindow,
        },
    },
};

#[derive(Clone, Debug)]
pub struct BrowserWindow {
    pub id: u64,
    pub title: String,
    pub process_name: String,
    pub client_width: i32,
    pub client_height: i32,
    pub dpi: u32,
}

#[derive(Debug)]
pub struct CapturedWindowFrame {
    pub png: Vec<u8>,
    pub origin_x: i32,
    pub origin_y: i32,
    pub dpi: u32,
}

fn hwnd(id: u64) -> HWND {
    id as usize as HWND
}

fn is_supported_browser_process(name: &str) -> bool {
    matches!(name, "chrome.exe" | "msedge.exe")
}

fn utf16(value: &[u16]) -> String {
    String::from_utf16_lossy(value)
        .trim_end_matches('\0')
        .trim()
        .to_owned()
}

fn window_title(handle: HWND) -> String {
    unsafe {
        let length = GetWindowTextLengthW(handle);
        if length <= 0 {
            return String::new();
        }
        let mut buffer = vec![0u16; length as usize + 1];
        let written = GetWindowTextW(handle, buffer.as_mut_ptr(), buffer.len() as i32);
        utf16(&buffer[..written.max(0) as usize])
    }
}

fn process_name(process_id: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if handle.is_null() {
            return None;
        }
        let mut buffer = vec![0u16; 32_768];
        let mut length = buffer.len() as u32;
        let success = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut length) != 0;
        let _ = CloseHandle(handle);
        success.then(|| {
            let path = utf16(&buffer[..length as usize]);
            path.rsplit(['\\', '/'])
                .next()
                .unwrap_or(&path)
                .to_ascii_lowercase()
        })
    }
}

fn window_process_id(handle: HWND) -> u32 {
    unsafe {
        let mut process_id = 0;
        GetWindowThreadProcessId(handle, &mut process_id);
        process_id
    }
}

fn token_is_elevated(process: HANDLE, close_process: bool) -> Result<bool, String> {
    unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(process, TOKEN_QUERY, &mut token) == 0 {
            if close_process {
                let _ = CloseHandle(process);
            }
            return Err("无法读取目标浏览器的权限状态".into());
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut returned = 0;
        let success = GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut TOKEN_ELEVATION as *mut c_void,
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        ) != 0;
        let _ = CloseHandle(token);
        if close_process {
            let _ = CloseHandle(process);
        }
        if !success {
            return Err("无法读取目标浏览器的权限状态".into());
        }
        Ok(elevation.TokenIsElevated != 0)
    }
}

fn ensure_matching_elevation(handle: HWND) -> Result<(), String> {
    let process_id = window_process_id(handle);
    if process_id == 0 {
        return Err("无法读取目标浏览器进程，请重新选择窗口".into());
    }
    unsafe {
        let target = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if target.is_null() {
            return Err("无法读取目标浏览器权限；请关闭后重新选择窗口".into());
        }
        let app_elevated = token_is_elevated(GetCurrentProcess(), false)?;
        let target_elevated = token_is_elevated(target, true)?;
        if app_elevated != target_elevated {
            return Err(
                "棋研与目标浏览器的管理员权限不一致。请以相同权限重启两者后再确认走子。".into(),
            );
        }
    }
    Ok(())
}

fn client_geometry(handle: HWND) -> Option<(i32, i32, i32, i32, u32)> {
    unsafe {
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetClientRect(handle, &mut rect) == 0 {
            return None;
        }
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width < 160 || height < 160 {
            return None;
        }
        let mut origin = POINT { x: 0, y: 0 };
        if ClientToScreen(handle, &mut origin) == 0 {
            return None;
        }
        Some((
            origin.x,
            origin.y,
            width,
            height,
            GetDpiForWindow(handle).max(96),
        ))
    }
}

fn valid_browser_window(handle: HWND) -> Option<BrowserWindow> {
    unsafe {
        if handle.is_null() || IsWindowVisible(handle) == 0 || IsIconic(handle) != 0 {
            return None;
        }
        let title = window_title(handle);
        if title.is_empty() {
            return None;
        }
        let process_id = window_process_id(handle);
        let process_name = process_name(process_id)?;
        if !is_supported_browser_process(&process_name) {
            return None;
        }
        let (.., width, height, dpi) = client_geometry(handle)?;
        Some(BrowserWindow {
            id: handle as usize as u64,
            title,
            process_name,
            client_width: width,
            client_height: height,
            dpi,
        })
    }
}

unsafe extern "system" fn enumerate_callback(handle: HWND, lparam: LPARAM) -> BOOL {
    let windows = &mut *(lparam as *mut Vec<BrowserWindow>);
    if let Some(target) = valid_browser_window(handle) {
        windows.push(target);
    }
    1
}

pub fn list_browser_windows() -> Vec<BrowserWindow> {
    let mut windows = Vec::<BrowserWindow>::new();
    unsafe {
        let _ = EnumWindows(Some(enumerate_callback), &mut windows as *mut _ as LPARAM);
    }
    windows.sort_by(|left, right| {
        left.process_name
            .cmp(&right.process_name)
            .then(left.title.cmp(&right.title))
    });
    windows
}

pub fn validate_browser_window(id: u64) -> Result<BrowserWindow, String> {
    let handle = hwnd(id);
    unsafe {
        if IsWindow(handle) == 0 {
            return Err("目标浏览器窗口已关闭，请重新选择窗口".into());
        }
        if IsIconic(handle) != 0 {
            return Err("目标浏览器窗口已最小化，请恢复窗口后重新连接".into());
        }
    }
    valid_browser_window(handle)
        .ok_or_else(|| "目标窗口不可捕获；请选择可见的 Chrome 或 Edge 天天象棋网页窗口".into())
}

pub fn capture_browser_window(id: u64) -> Result<CapturedWindowFrame, String> {
    let target = validate_browser_window(id)?;
    let handle = hwnd(id);
    let (origin_x, origin_y, width, height, dpi) =
        client_geometry(handle).ok_or("无法读取目标浏览器客户区尺寸")?;
    unsafe {
        let source = GetDC(handle);
        if source.is_null() {
            return Err("无法读取目标浏览器画面；请确认窗口没有被系统安全界面遮挡".into());
        }
        let memory = CreateCompatibleDC(source);
        let bitmap = CreateCompatibleBitmap(source, width, height);
        if memory.is_null() || bitmap.is_null() {
            if !memory.is_null() {
                let _ = DeleteDC(memory);
            }
            let _ = ReleaseDC(handle, source);
            return Err("Windows 原生窗口采集初始化失败".into());
        }
        let previous = SelectObject(memory, bitmap as *mut c_void);
        let copied = BitBlt(memory, 0, 0, width, height, source, 0, 0, SRCCOPY) != 0;
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: (width * height * 4) as u32,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        };
        let mut bgra = vec![0u8; width as usize * height as usize * 4];
        let rows = if copied {
            GetDIBits(
                memory,
                bitmap,
                0,
                height as u32,
                bgra.as_mut_ptr() as *mut c_void,
                &mut info,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };
        let _ = SelectObject(memory, previous);
        let _ = DeleteObject(bitmap as *mut c_void);
        let _ = DeleteDC(memory);
        let _ = ReleaseDC(handle, source);
        if rows != height {
            return Err("Windows 原生窗口采集失败；请保持浏览器窗口可见且未最小化".into());
        }
        for pixel in bgra.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }
        let image = RgbaImage::from_raw(width as u32, height as u32, bgra)
            .ok_or("Windows 窗口帧格式无效")?;
        let mut png = Vec::new();
        DynamicImage::ImageRgba8(image)
            .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
            .map_err(|error| error.to_string())?;
        let _ = target;
        Ok(CapturedWindowFrame {
            png,
            origin_x,
            origin_y,
            dpi,
        })
    }
}

pub fn click_browser_points(id: u64, from: (f32, f32), to: (f32, f32)) -> Result<(), String> {
    let _ = validate_browser_window(id)?;
    let handle = hwnd(id);
    ensure_matching_elevation(handle)?;
    unsafe {
        if SetForegroundWindow(handle) == 0 {
            return Err("无法前置目标浏览器窗口；请手动点一下该窗口后重试".into());
        }
        for point in [from, to] {
            if SetCursorPos(point.0.round() as i32, point.1.round() as i32) == 0 {
                return Err("无法定位 Windows 鼠标；请确认棋研与浏览器使用相同权限启动".into());
            }
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
            std::thread::sleep(std::time::Duration::from_millis(260));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_supported_browser_process;

    #[test]
    fn browser_filter_is_explicit() {
        assert!(is_supported_browser_process("chrome.exe"));
        assert!(is_supported_browser_process("msedge.exe"));
        assert!(!is_supported_browser_process("notepad.exe"));
    }
}
