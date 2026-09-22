# 棋析逻辑残棋 sidecar

棋析 V1.0.3 支持在导入 CBL 时同时选择一个 `.logic.json` 文件，为残局训练附加本地逻辑讲解。sidecar 不会联网，不会修改 CBL 原文件，也不会写入真实棋谱树；它只随题库解析结果保存到应用私有 SQLite。

## 命名与导入

- 推荐命名：`题库名.logic.json`。
- 在“导入 CBL”文件选择器里同时选择 `.cbl` 和 `.logic.json`。
- URL 导入只下载 CBL，不附加 sidecar。

## 格式

可以按 `sourceIndex` 匹配 CBL 记录，也可以按题名匹配：

```json
{
  "problems": [
    {
      "sourceIndex": 0,
      "themes": ["弃子引离", "连续将军"],
      "goal": "用连续强制着把黑将引入底线杀形。",
      "firstMoveIdea": "首着先将军，不给黑方整理防守的时间。",
      "keyDefense": "注意黑方回将后仍有垫子防守。",
      "failureReason": "慢手会让黑方补士或平车解围。",
      "review": "本题核心是先手连续性：每一步都要带将或形成唯一防守。",
      "hints": [
        "先找所有将军手。",
        "关键是把防守棋子引离中路。",
        "首着必须保持连续将军。"
      ],
      "mistakes": {
        "h2e2": "这步虽然看似进攻，但没有将军，黑方可以补士后守住。"
      }
    },
    {
      "title": "车马冷着",
      "logic": {
        "themes": ["冷着", "控制将门"],
        "goal": "先控制将门，再用马后炮收束。"
      }
    }
  ]
}
```

## 字段说明

- `themes`：题型或战术主题。
- `goal`：本题要完成的局面目标。
- `firstMoveIdea`：首着思路，不必直接泄露答案。
- `keyDefense`：对方关键防守资源。
- `failureReason`：合法但偏离题解时的默认错因。
- `review`：看答案后的复盘说明。
- `hints`：三层提示，依次对应方向提示、战术点提示、首着提示。
- `mistakes`：按 ICCS 着法给具体错因，优先级高于 `failureReason`。
