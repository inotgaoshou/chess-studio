#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, PFScoreKind) {
    PFScoreKindCentipawn = 0,
    PFScoreKindMate = 1,
};

@interface PFAnalysisLine : NSObject
@property(nonatomic, readonly) NSInteger multipv;
@property(nonatomic, readonly) NSInteger depth;
@property(nonatomic, readonly) PFScoreKind scoreKind;
@property(nonatomic, readonly) NSInteger scoreValue;
@property(nonatomic, readonly) uint64_t nodes;
@property(nonatomic, readonly) uint64_t nps;
@property(nonatomic, copy, readonly) NSArray<NSString *> *pv;
@end

@interface PFAnalysisResult : NSObject
@property(nonatomic, copy, readonly) NSString *bestMove;
@property(nonatomic, copy, readonly) NSArray<PFAnalysisLine *> *lines;
@end

typedef void (^PFAnalysisUpdateHandler)(NSArray<PFAnalysisLine *> *lines);
typedef void (^PFAnalysisCompletionHandler)(PFAnalysisResult * _Nullable result, NSError * _Nullable error);

@interface PFPikafishEngine : NSObject
- (instancetype)initWithNetworkPath:(NSString *)networkPath NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
- (void)analyzeFen:(NSString *)fen
        moveTimeMs:(NSInteger)moveTimeMs
           threads:(NSInteger)threads
            hashMB:(NSInteger)hashMB
           multiPV:(NSInteger)multiPV
            update:(PFAnalysisUpdateHandler)update
        completion:(PFAnalysisCompletionHandler)completion;
- (void)cancel;
- (void)releaseResources;
@end

NS_ASSUME_NONNULL_END
