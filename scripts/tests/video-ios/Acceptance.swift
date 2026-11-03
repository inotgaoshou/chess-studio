import XCTest
final class Acceptance: XCTestCase {
 func capture(_ app: XCUIApplication, _ name: String) { let a=XCTAttachment(screenshot:app.screenshot());a.name=name;a.lifetime = .keepAlways;add(a) }
 func testDirectoryHorizontalGestures() throws {
  continueAfterFailure=false
  let app=XCUIApplication(bundleIdentifier:"cn.xiangqi.endgame.training.family")
  app.terminate();XCUIDevice.shared.orientation = .portrait;app.launch()
  XCTAssertTrue(app.wait(for:.runningForeground,timeout:15))
  if app.buttons["仅本地使用"].waitForExistence(timeout:2){app.buttons["仅本地使用"].tap()}
  if app.buttons["回到学习"].exists{app.buttons["回到学习"].tap()}
  if !app.buttons["全屏播放"].waitForExistence(timeout:2) {
   app.buttons["首页"].tap()
   let entry=app.buttons.matching(NSPredicate(format:"label CONTAINS %@ OR label CONTAINS %@","视频课堂","继续学习")).firstMatch
   XCTAssertTrue(entry.waitForExistence(timeout:10));entry.tap()
  }
  let fullscreen=app.buttons["全屏播放"]
  XCTAssertTrue(fullscreen.waitForExistence(timeout:10))
  for orientation in [UIDeviceOrientation.portrait,.landscapeLeft,.portrait] {
   XCUIDevice.shared.orientation=orientation
   expectation(for:NSPredicate{_,_ in orientation == .portrait ? app.frame.width<app.frame.height : app.frame.width>app.frame.height},evaluatedWith:nil);waitForExpectations(timeout:10)
   let titles=app.buttons["标题"]
   if titles.exists && titles.isHittable{titles.tap()}
   let episode=app.buttons.matching(NSPredicate(format:"label MATCHES %@","第[0-9]+段 .*")).firstMatch
   XCTAssertTrue(episode.waitForExistence(timeout:8))
   let before=fullscreen.frame,episodeBefore=episode.frame
   // Drag within the lower episode area, away from the native video timeline.
   let y=min(app.frame.maxY-100,max(episode.frame.midY,before.maxY+45))
   let left=max(episode.frame.minX+12,app.frame.minX+16)
   let right=min(episode.frame.maxX-12,app.frame.maxX-16)
   XCTAssertGreaterThan(right,left)
   let a=app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:left,dy:y))
   let b=app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:right,dy:y))
   a.press(forDuration:0.05,thenDragTo:b);b.press(forDuration:0.05,thenDragTo:a)
   XCTAssertLessThanOrEqual(abs(episode.frame.minX-episodeBefore.minX),2,"Horizontal drags must not offset the episode list")
   XCTAssertLessThanOrEqual(abs(episode.frame.width-episodeBefore.width),2,"Horizontal drags must not change the episode layout")
   XCTAssertGreaterThanOrEqual(episode.frame.minX,app.frame.minX,"Episode titles must not shift left out of the directory")
   XCTAssertLessThanOrEqual(episode.frame.maxX,app.frame.maxX,"Episode titles must stay within the directory")
   XCTAssertLessThanOrEqual(abs(fullscreen.frame.minY-before.minY),2,"Directory drags must leave the player fixed")
   capture(app,orientation == .portrait ? "directory-portrait-after-horizontal-drags" : "directory-landscape-after-horizontal-drags")
  }
 }
 func seconds(_ value:Any?) -> Int {
  let numbers=(value as? String ?? "").components(separatedBy:CharacterSet.decimalDigits.inverted).compactMap(Int.init)
  return numbers.count>=2 ? numbers[0]*60+numbers[1] : numbers.first ?? -1
 }
 func testVideo() throws {
  continueAfterFailure=false
  let app=XCUIApplication(bundleIdentifier:"cn.xiangqi.endgame.training.family")
  app.terminate();XCUIDevice.shared.orientation = .portrait;app.launch()
  XCTAssertTrue(app.wait(for:.runningForeground,timeout:15))
  if app.buttons["仅本地使用"].waitForExistence(timeout:3){app.buttons["仅本地使用"].tap()}
  if app.buttons["回到学习"].exists{app.buttons["回到学习"].tap()}
  if !app.buttons["全屏播放"].waitForExistence(timeout:2) {
    app.buttons["首页"].tap()
    let entry=app.buttons.matching(NSPredicate(format:"label CONTAINS %@ OR label CONTAINS %@","视频课堂","继续学习")).firstMatch
    XCTAssertTrue(entry.waitForExistence(timeout:10));entry.tap()
  }
  if !app.buttons["全屏播放"].waitForExistence(timeout:2) {
    let category=app.buttons["布局"];XCTAssertTrue(category.waitForExistence(timeout:15));category.tap()
    let number=app.buttons["第1段 1学习布局的最佳方式"];XCTAssertTrue(number.waitForExistence(timeout:10));number.tap()
  }
  // The fixture is the 9m28s first layout lesson; native accessibility exposes its time.
  let movie=app.otherElements.matching(NSPredicate(format:"label CONTAINS %@ AND (label CONTAINS %@ OR label CONTAINS %@)","9","分","minute")).firstMatch
  XCTAssertTrue(movie.waitForExistence(timeout:12),"Native video metadata must load")
  let initial=seconds(movie.value);XCTAssertGreaterThanOrEqual(initial,0)
  let play=app.buttons.matching(NSPredicate(format:"label == %@","播放")).firstMatch
  XCTAssertTrue(play.waitForExistence(timeout:4));play.tap()
  expectation(for:NSPredicate { _,_ in self.seconds(movie.value)>initial },evaluatedWith:nil);waitForExpectations(timeout:8)
  let pause=app.buttons.matching(NSPredicate(format:"label == %@","暂停")).firstMatch
  XCTAssertTrue(pause.waitForExistence(timeout:4));pause.tap()
  let beforePractice=seconds(movie.value);XCTAssertGreaterThan(beforePractice,initial)
  XCTAssertFalse(app.buttons["+10秒"].exists,"The redundant seek button was removed")
  XCTAssertFalse(app.searchFields["搜索课程"].exists,"Search starts collapsed")
  app.buttons["更多播放操作"].tap()
  XCTAssertTrue(app.buttons["加书签"].waitForExistence(timeout:5));XCTAssertTrue(app.buttons["加书签"].isHittable)
  capture(app,"video-more-actions")
  app.buttons["加书签"].tap();app.buttons["去练棋"].tap()
  XCTAssertTrue(app.buttons["‹ 返回视频学习"].waitForExistence(timeout:8));app.buttons["‹ 返回视频学习"].tap()
  XCTAssertTrue(app.buttons["全屏播放"].waitForExistence(timeout:8));XCTAssertTrue(movie.waitForExistence(timeout:10))
  XCTAssertLessThanOrEqual(abs(seconds(movie.value)-beforePractice),2,"Return must restore the saved position")
  XCTAssertTrue(app.buttons.matching(NSPredicate(format:"label == %@","播放")).firstMatch.exists,"Restored video stays paused")
  capture(app,"video-player-compact")
  app.buttons["展开课程搜索"].tap()
  let search=app.descendants(matching:.any).matching(NSPredicate(format:"label == %@","搜索课程")).firstMatch
  XCTAssertTrue(search.waitForExistence(timeout:5));XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:8))
  app.buttons["收起课程搜索"].tap()
  expectation(for:NSPredicate{_,_ in !app.keyboards.firstMatch.exists},evaluatedWith:nil);waitForExpectations(timeout:8)
  XCTAssertTrue(app.buttons["全屏播放"].isHittable,"Collapsing search restores playback controls")
  let portrait=app.frame.width<app.frame.height
  app.buttons["全屏播放"].tap()
  expectation(for:NSPredicate{_,_ in app.frame.width>app.frame.height},evaluatedWith:nil);waitForExpectations(timeout:10)
  capture(app,"video-fullscreen-landscape")
  app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.85)).tap()
  let done=app.buttons.matching(NSPredicate(format:"label IN %@",["退出全屏","完成","关闭","Done","Close","Exit Full Screen"])).firstMatch
  XCTAssertTrue(done.waitForExistence(timeout:5),"Fullscreen must expose an exit control: \(app.debugDescription)");done.tap()
  XCTAssertTrue(app.buttons["全屏播放"].waitForExistence(timeout:8))
  if portrait{expectation(for:NSPredicate{_,_ in app.frame.width<app.frame.height},evaluatedWith:nil);waitForExpectations(timeout:10)}
  XCTAssertLessThanOrEqual(abs(seconds(movie.value)-beforePractice),2)
  XCTAssertEqual(app.staticTexts.matching(NSPredicate(format:"label CONTAINS %@","无法播放此 MP4")).count,0)
  let frameBeforeRename=movie.frame
  app.buttons["重命名当前视频"].tap()
  XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:8))
  app.buttons["取消"].tap()
  expectation(for:NSPredicate{_,_ in !app.keyboards.firstMatch.exists},evaluatedWith:nil);waitForExpectations(timeout:8)
  XCTAssertTrue(app.buttons["全屏播放"].isHittable,"Cancel must restore playback interaction")
  XCTAssertLessThanOrEqual(abs(movie.frame.height-frameBeforeRename.height),3,"Cancel must restore the full viewport")
  capture(app,"video-player-after-rename-cancel")
  app.buttons["管理"].tap();app.buttons["视频管理"].tap()
  let rename=app.buttons["改名 1学习布局的最佳方式"]
  XCTAssertTrue(rename.waitForExistence(timeout:8));rename.tap()
  XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:8),"Rename must focus the name field")
  let save=app.buttons["保存"]
  XCTAssertTrue(save.waitForExistence(timeout:5));XCTAssertTrue(save.isHittable,"Keyboard and navigation must not cover Save")
  capture(app,"video-rename-keyboard")
  app.buttons["取消"].tap()
  let remove=app.buttons["删除视频 1学习布局的最佳方式"]
  XCTAssertTrue(remove.waitForExistence(timeout:8));remove.tap()
  XCTAssertTrue(app.buttons["确认删除"].waitForExistence(timeout:5));XCTAssertTrue(app.buttons["确认删除"].isHittable)
  capture(app,"video-delete-confirmation")
  app.buttons["取消，保留内容"].tap()
  XCTAssertTrue(rename.waitForExistence(timeout:5),"Cancel must retain the lesson and restore interaction")
 }
}
