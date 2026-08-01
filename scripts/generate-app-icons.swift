import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let tauriIconDir = root.appendingPathComponent("apps/desktop/src-tauri/icons", isDirectory: true)
let publicIconDir = root.appendingPathComponent("apps/desktop/public/icons", isDirectory: true)

try FileManager.default.createDirectory(at: tauriIconDir, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: publicIconDir, withIntermediateDirectories: true)

func savePng(_ image: NSImage, size: Int, to url: URL) throws {
    let output = NSImage(size: NSSize(width: size, height: size))
    output.lockFocus()
    NSGraphicsContext.current?.imageInterpolation = .high
    image.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .copy, fraction: 1)
    output.unlockFocus()
    guard
        let tiff = output.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let data = bitmap.representation(using: .png, properties: [:])
    else {
        throw NSError(domain: "icon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to render PNG"])
    }
    try data.write(to: url, options: .atomic)
}

func drawIcon(size: Int) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    let rect = NSRect(x: 0, y: 0, width: size, height: size)
    NSColor.clear.setFill()
    rect.fill()

    let pieceRect = rect.insetBy(dx: CGFloat(size) * 0.085, dy: CGFloat(size) * 0.085)
    let shadowRect = pieceRect.offsetBy(dx: 0, dy: -CGFloat(size) * 0.035)
    NSColor.black.withAlphaComponent(0.24).setFill()
    NSBezierPath(ovalIn: shadowRect).fill()

    let outerPath = NSBezierPath(ovalIn: pieceRect)
    NSGradient(colors: [
        NSColor(calibratedRed: 0.98, green: 0.88, blue: 0.52, alpha: 1),
        NSColor(calibratedRed: 0.78, green: 0.47, blue: 0.17, alpha: 1),
        NSColor(calibratedRed: 0.95, green: 0.72, blue: 0.30, alpha: 1),
    ])?.draw(in: outerPath, angle: 135)

    NSColor(calibratedRed: 0.55, green: 0.29, blue: 0.09, alpha: 1).setStroke()
    outerPath.lineWidth = CGFloat(size) * 0.018
    outerPath.stroke()

    let innerRect = pieceRect.insetBy(dx: CGFloat(size) * 0.075, dy: CGFloat(size) * 0.075)
    let innerPath = NSBezierPath(ovalIn: innerRect)
    NSGradient(colors: [
        NSColor(calibratedRed: 1.00, green: 0.93, blue: 0.67, alpha: 1),
        NSColor(calibratedRed: 0.93, green: 0.73, blue: 0.37, alpha: 1),
        NSColor(calibratedRed: 0.99, green: 0.88, blue: 0.55, alpha: 1),
    ])?.draw(in: innerPath, angle: 35)

    NSColor(calibratedRed: 0.66, green: 0.34, blue: 0.10, alpha: 1).setStroke()
    innerPath.lineWidth = CGFloat(size) * 0.012
    innerPath.stroke()

    let ringRect = innerRect.insetBy(dx: CGFloat(size) * 0.055, dy: CGFloat(size) * 0.055)
    let ringPath = NSBezierPath(ovalIn: ringRect)
    NSColor(calibratedRed: 0.62, green: 0.22, blue: 0.08, alpha: 0.95).setStroke()
    ringPath.lineWidth = CGFloat(size) * 0.016
    ringPath.stroke()

    let highlightRect = NSRect(
        x: pieceRect.minX + CGFloat(size) * 0.20,
        y: pieceRect.minY + CGFloat(size) * 0.58,
        width: CGFloat(size) * 0.34,
        height: CGFloat(size) * 0.18
    )
    NSGradient(colors: [
        NSColor.white.withAlphaComponent(0.34),
        NSColor.white.withAlphaComponent(0.02),
    ])?.draw(in: NSBezierPath(ovalIn: highlightRect), angle: 90)

    let fontSize = CGFloat(size) * 0.48
    let font = NSFont(name: "Kaiti SC", size: fontSize)
        ?? NSFont(name: "Songti SC", size: fontSize)
        ?? NSFont.systemFont(ofSize: fontSize, weight: .heavy)
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor(calibratedRed: 0.72, green: 0.05, blue: 0.04, alpha: 1),
        .paragraphStyle: paragraph,
        .strokeColor: NSColor(calibratedRed: 0.42, green: 0.02, blue: 0.02, alpha: 0.9),
        .strokeWidth: -2.2,
    ]
    let text = "帅" as NSString
    let textRect = NSRect(
        x: CGFloat(size) * 0.22,
        y: CGFloat(size) * 0.255,
        width: CGFloat(size) * 0.56,
        height: CGFloat(size) * 0.56
    )
    text.draw(in: textRect, withAttributes: attributes)

    image.unlockFocus()
    return image
}

let icon = drawIcon(size: 1024)
try savePng(icon, size: 512, to: tauriIconDir.appendingPathComponent("icon.png"))
try savePng(icon, size: 32, to: tauriIconDir.appendingPathComponent("32x32.png"))
try savePng(icon, size: 128, to: tauriIconDir.appendingPathComponent("128x128.png"))
try savePng(icon, size: 256, to: tauriIconDir.appendingPathComponent("128x128@2x.png"))
try savePng(icon, size: 192, to: publicIconDir.appendingPathComponent("icon-192.png"))
try savePng(icon, size: 512, to: publicIconDir.appendingPathComponent("icon-512.png"))

let iconset = tauriIconDir.appendingPathComponent("XiangqiStudio.iconset", isDirectory: true)
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
let iconsetSizes: [(String, Int)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]
for (name, size) in iconsetSizes {
    try savePng(icon, size: size, to: iconset.appendingPathComponent(name))
}
