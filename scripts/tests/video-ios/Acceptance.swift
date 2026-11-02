import XCTest
final class Acceptance: XCTestCase {
 func capture(_ app: XCUIApplication, _ name: String) { let a=XCTAttachment(screenshot:app.screenshot());a.name=name;a.lifetime = .keepAlways;add(a) }
 func testVideo() throws {
  continueAfterFailure=false
  let app=XCUIApplication(bundleIdentifier:"cn.xiangqi.endgame.training.family");app.activate()
  XCTAssertTrue(app.wait(for:.runningForeground,timeout:15))
  if app.buttons["仅本地使用"].waitForExistence(timeout:5){app.buttons["仅本地使用"].tap()}
  if !app.buttons["去练棋"].waitForExistence(timeout:2) {
    app.buttons["首页"].tap()
    let entry=app.buttons.matching(NSPredicate(format:"label CONTAINS %@ OR label CONTAINS %@","视频学习","继续学习")).firstMatch
    XCTAssertTrue(entry.waitForExistence(timeout:10));entry.tap()
  }
  if !app.buttons["去练棋"].waitForExistence(timeout:2) {
    let series=app.buttons["01赵鑫鑫布局棋理48讲"];XCTAssertTrue(series.waitForExistence(timeout:15));series.tap()
    let chapter=app.buttons["全部视频 · 1段"];XCTAssertTrue(chapter.waitForExistence(timeout:10));chapter.tap()
    let number=app.buttons["第1段 1学习布局的最佳方式"];XCTAssertTrue(number.waitForExistence(timeout:10));number.tap()
  }
  Thread.sleep(forTimeInterval:3)
  app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.42)).tap()
  Thread.sleep(forTimeInterval:3)
  app.buttons["+10秒"].tap();app.buttons["+10秒"].tap();app.buttons["+10秒"].tap()
  app.buttons["加书签"].tap()
  app.buttons["去练棋"].tap()
  XCTAssertTrue(app.buttons["‹ 返回视频学习"].waitForExistence(timeout:8));app.buttons["‹ 返回视频学习"].tap()
  XCTAssertTrue(app.buttons["去练棋"].waitForExistence(timeout:8))
  capture(app,"video-player-initial")
  print("QIXI_UI_TREE_START\n"+app.debugDescription+"\nQIXI_UI_TREE_END")
 }
}
