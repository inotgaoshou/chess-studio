#import "PFPikafishEngine.h"

#include <atomic>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

#include "attacks.h"
#include "engine.h"
#include "misc.h"
#include "position.h"
#include "search.h"
#include "uci.h"

using namespace Stockfish;

static NSString *const PFPikafishErrorDomain = @"PFPikafishErrorDomain";

@interface PFAnalysisLine ()
- (instancetype)initWithMultiPV:(NSInteger)multipv
                          depth:(NSInteger)depth
                      scoreKind:(PFScoreKind)scoreKind
                     scoreValue:(NSInteger)scoreValue
                          nodes:(uint64_t)nodes
                            nps:(uint64_t)nps
                             pv:(NSArray<NSString *> *)pv;
@end

@implementation PFAnalysisLine
- (instancetype)initWithMultiPV:(NSInteger)multipv
                          depth:(NSInteger)depth
                      scoreKind:(PFScoreKind)scoreKind
                     scoreValue:(NSInteger)scoreValue
                          nodes:(uint64_t)nodes
                            nps:(uint64_t)nps
                             pv:(NSArray<NSString *> *)pv {
    self = [super init];
    if (self) {
        _multipv = multipv;
        _depth = depth;
        _scoreKind = scoreKind;
        _scoreValue = scoreValue;
        _nodes = nodes;
        _nps = nps;
        _pv = [pv copy];
    }
    return self;
}
@end

@interface PFAnalysisResult ()
- (instancetype)initWithBestMove:(NSString *)bestMove lines:(NSArray<PFAnalysisLine *> *)lines;
@end

@implementation PFAnalysisResult
- (instancetype)initWithBestMove:(NSString *)bestMove lines:(NSArray<PFAnalysisLine *> *)lines {
    self = [super init];
    if (self) {
        _bestMove = [bestMove copy];
        _lines = [lines copy];
    }
    return self;
}
@end

static NSString *PFString(std::string_view value) {
    std::string copy(value);
    return [[NSString alloc] initWithBytes:copy.data() length:copy.size() encoding:NSUTF8StringEncoding] ?: @"";
}

static NSArray<NSString *> *PFMoves(std::string_view value) {
    std::istringstream stream{std::string(value)};
    std::vector<std::string> moves;
    std::string move;
    while (stream >> move) {
        moves.push_back(move);
    }
    NSMutableArray<NSString *> *result = [NSMutableArray arrayWithCapacity:moves.size()];
    for (const auto &item : moves) {
        [result addObject:PFString(item)];
    }
    return result;
}

static NSArray<PFAnalysisLine *> *PFSortedLines(NSDictionary<NSNumber *, PFAnalysisLine *> *lines) {
    NSArray<NSNumber *> *keys = [[lines allKeys] sortedArrayUsingSelector:@selector(compare:)];
    NSMutableArray<PFAnalysisLine *> *result = [NSMutableArray arrayWithCapacity:keys.count];
    for (NSNumber *key in keys) {
        PFAnalysisLine *line = lines[key];
        if (line) [result addObject:line];
    }
    return [result copy];
}

static std::pair<PFScoreKind, NSInteger> PFScore(const Score &score) {
    std::istringstream stream(UCIEngine::format_score(score));
    std::string kind;
    NSInteger value = 0;
    stream >> kind >> value;
    return {kind == "mate" ? PFScoreKindMate : PFScoreKindCentipawn, value};
}

static NSError *PFError(NSInteger code, NSString *message) {
    return [NSError errorWithDomain:PFPikafishErrorDomain code:code userInfo:@{NSLocalizedDescriptionKey: message}];
}

@implementation PFPikafishEngine {
    NSString *_networkPath;
    dispatch_queue_t _queue;
    std::unique_ptr<Engine> _engine;
    std::shared_ptr<std::atomic<uint64_t>> _generation;
    std::mutex _activeMutex;
    Engine *_activeEngine;
}

- (instancetype)initWithNetworkPath:(NSString *)networkPath {
    self = [super init];
    if (self) {
        _networkPath = [networkPath copy];
        _queue = dispatch_queue_create("org.pikafish.ios.engine", DISPATCH_QUEUE_SERIAL);
        _generation = std::make_shared<std::atomic<uint64_t>>(0);
        _activeEngine = nullptr;
        static std::once_flag initializeOnce;
        std::call_once(initializeOnce, [] {
            Attacks::init();
            Position::init();
        });
    }
    return self;
}

- (void)analyzeFen:(NSString *)fen
        moveTimeMs:(NSInteger)moveTimeMs
           threads:(NSInteger)threads
            hashMB:(NSInteger)hashMB
        multiPV:(NSInteger)multiPV
            update:(PFAnalysisUpdateHandler)update
        completion:(PFAnalysisCompletionHandler)completion {
    auto generation = _generation;
    const uint64_t request = generation->fetch_add(1) + 1;
    [self stopActiveEngine];

    NSString *fenCopy = [fen copy];
    NSString *networkPath = [_networkPath copy];
    PFAnalysisUpdateHandler updateCopy = [update copy];
    PFAnalysisCompletionHandler completionCopy = [completion copy];

    dispatch_async(_queue, ^{
        if (generation->load() != request) return;

        if (![[NSFileManager defaultManager] fileExistsAtPath:networkPath]) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (generation->load() == request) completionCopy(nil, PFError(1, @"安装包缺少 NNUE 文件"));
            });
            return;
        }

        if (!self->_engine) {
            self->_engine = std::make_unique<Engine>();
            std::istringstream evalFile("name EvalFile value " + std::string(networkPath.UTF8String));
            self->_engine->get_options().setoption(evalFile);
        }

        auto setOption = [self](const char *name, NSInteger value) {
            std::istringstream command("name " + std::string(name) + " value " + std::to_string(value));
            self->_engine->get_options().setoption(command);
        };
        setOption("Threads", MAX(1, MIN(4, threads)));
        setOption("Hash", MAX(16, MIN(128, hashMB)));
        setOption("MultiPV", MAX(1, MIN(5, multiPV)));

        const std::string fenValue(fenCopy.UTF8String ?: "");
        if (auto error = self->_engine->set_position(fenValue, {})) {
            NSString *message = PFString(std::string_view(error->what()));
            dispatch_async(dispatch_get_main_queue(), ^{
                if (generation->load() == request) completionCopy(nil, PFError(2, message));
            });
            return;
        }

        NSMutableDictionary<NSNumber *, PFAnalysisLine *> *latestLines = [NSMutableDictionary dictionary];
        auto bestMove = std::make_shared<std::string>();

        self->_engine->set_on_update_no_moves([](const Engine::InfoShort &) {});
        self->_engine->set_on_iter([](const Engine::InfoIter &) {});
        self->_engine->set_on_start([] {});
        self->_engine->set_on_verify_network([](std::string_view) {});
        self->_engine->set_on_update_full([generation, request, latestLines, updateCopy](const Engine::InfoFull &info) {
            if (generation->load() != request) return;
            const auto score = PFScore(info.score);
            PFAnalysisLine *line = [[PFAnalysisLine alloc]
                initWithMultiPV:static_cast<NSInteger>(info.multiPV)
                depth:info.depth
                scoreKind:score.first
                scoreValue:score.second
                nodes:static_cast<uint64_t>(info.nodes)
                nps:static_cast<uint64_t>(info.nps)
                pv:PFMoves(info.pv)];
            latestLines[@(line.multipv)] = line;
            NSArray<PFAnalysisLine *> *snapshotCopy = PFSortedLines(latestLines);
            dispatch_async(dispatch_get_main_queue(), ^{
                if (generation->load() == request) updateCopy(snapshotCopy);
            });
        });
        self->_engine->set_on_bestmove([bestMove](std::string_view move, std::string_view) {
            bestMove->assign(move);
        });

        Search::LimitsType limits;
        limits.startTime = now();
        limits.movetime = MAX(100, MIN(10'000, moveTimeMs));
        {
            std::lock_guard<std::mutex> lock(self->_activeMutex);
            if (generation->load() != request) {
                self->_engine->set_on_update_full([](const Engine::InfoFull &) {});
                self->_engine->set_on_bestmove([](std::string_view, std::string_view) {});
                return;
            }
            self->_activeEngine = self->_engine.get();
            self->_engine->go(limits);
        }
        self->_engine->wait_for_search_finished();
        self->_engine->set_on_update_full([](const Engine::InfoFull &) {});
        self->_engine->set_on_bestmove([](std::string_view, std::string_view) {});

        {
            std::lock_guard<std::mutex> lock(self->_activeMutex);
            self->_activeEngine = nullptr;
        }

        if (generation->load() != request) return;
        NSArray<PFAnalysisLine *> *finalLines = PFSortedLines(latestLines);
        NSString *bestMoveString = PFString(*bestMove);
        if (bestMoveString.length == 0 && finalLines.firstObject.pv.count > 0) {
            bestMoveString = finalLines.firstObject.pv.firstObject;
        }
        PFAnalysisResult *result = [[PFAnalysisResult alloc] initWithBestMove:bestMoveString lines:finalLines];
        dispatch_async(dispatch_get_main_queue(), ^{
            if (generation->load() == request) completionCopy(result, nil);
        });
    });
}

- (void)cancel {
    _generation->fetch_add(1);
    [self stopActiveEngine];
}

- (void)releaseResources {
    [self cancel];
    dispatch_async(_queue, ^{
        self->_engine.reset();
    });
}

- (void)stopActiveEngine {
    std::lock_guard<std::mutex> lock(_activeMutex);
    if (_activeEngine) _activeEngine->stop();
}

- (void)dealloc {
    [self cancel];
}

@end
