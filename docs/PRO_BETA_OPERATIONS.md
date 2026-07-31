# Pro 内测运营手册

本阶段仅用于受控的个人 Pro 内测：建议价格为 99 元/年，但由运营人工收款和发码，产品不处理支付、续费或退款。

## 创建兑换码

1. 用安全的密码管理器生成随机兑换码，例如 `XQS-2026-` 加 16 个随机大写字母和数字。
2. 在本机计算大写兑换码的 SHA-256 值。不要把明文兑换码写进数据库、工单或日志：

```sh
printf '%s' 'XQS-2026-EXAMPLECODE' | shasum -a 256
```

3. 将得到的 64 位哈希插入数据库；`duration_days` 为权益天数，`cloud_analysis_quota` 为每 30 天的云分析次数。以下 SQL 中的哈希只是占位符：

```sql
INSERT INTO redemption_codes
  (id, code_hash, plan, duration_days, cloud_analysis_quota, max_redemptions, starts_at, expires_at)
VALUES
  (UUID(), '<sha256-hash>', 'pro', 365, 100, 1, UTC_TIMESTAMP(6), '2027-12-31 23:59:59.999999');
```

4. 通过私密渠道把明文码发给目标用户。用户需先登录同步账号，再在“同步 -> Pro 权益”兑换。

## 撤销与支持

撤销未使用的码：

```sql
UPDATE redemption_codes SET revoked_at = UTC_TIMESTAMP(6) WHERE id = '<code-id>' AND revoked_at IS NULL;
```

立即停止某个用户的 Pro 权益：

```sql
UPDATE subscription_entitlements SET status = 'revoked' WHERE user_id = '<user-id>';
```

兑换、到期和撤销均由服务端判定。客户端离线或权益接口不可用时，本地棋谱、本地引擎和离线复盘不受影响；云分析会提示不可用或额度已耗尽。

## 每周内测看板

不要上传棋谱正文作为默认埋点。以下查询使用产品事件观察漏斗：

```sql
SELECT event_name, COUNT(DISTINCT user_id) AS users
FROM product_events
WHERE occurred_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY
GROUP BY event_name;
```

本阶段至少跟踪：`registered`、`subscription_redeemed`、`cloud_analysis_consumed`，以及后续服务端接入的首份报告、训练完成和报告分享事件。桌面训练任务目前离线保存，因此完成率需要通过受访者回访或后续同步事件汇总。

90 天判断标准为：招募 50 位目标棋手，至少 10 位在第 2 个月每周完成一次复盘或训练。达到标准后再启动微信支付、支付宝和教练端原型；未达到标准，优先访谈流失用户并优化训练闭环。

## 许可边界

公开收费前必须完成 Pikafish/NNUE 商业授权，以及客户端 GPL-3.0 和依赖许可审查。本内测不构成正式商业分发或对收费模式的承诺。
