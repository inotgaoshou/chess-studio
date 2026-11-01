# 困毙参考声线素材 v5

本轮不使用预设播音员声线。以用户要求对齐的现有 `v109-checkmate.wav` 为声音参考，生成说“困毙”的双字语音，保留为 `source.wav`（24kHz、16bit 单声道）。

- 模型：`mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit`，revision `0d6bb6fe33f92d47a507e23b9148940e8366ab5b`。
- 工具：`mlx-audio==0.6.3`，`mlx==0.32.4`，在 Mac 本机推理。
- 参考：绝杀录音重复三遍，每遍间隔 120ms；转写 `绝杀！绝杀！绝杀！`。
- 输出文本：`困毙！`；语言 `chinese`，seed `42`，temperature `.65`，top_p `.9`，max_tokens `64`。
- 重混音：`python3 scripts/generate-stalemate-feedback.py`。只读取已生成素材及绝杀参考，不联网。
- 重新生成声线：在安装上述工具的环境执行 `python scripts/generate-stalemate-feedback.py --regenerate-source /path/to/model`。
- 成品按绝杀原音的 40ms 能量包络匹配重音与停顿，保持原声调，不另加低频冲击声。

模型与开发工具均不打进 App。音调与时长指标不能代替用户听感验收；参考声线生成也不保证与原录音完全一致。
