# 困毙男声素材 v4

- 语音：Microsoft Edge `zh-CN-YunjianNeural`，普通话男声。
- 输入：分别合成 `困！`、`毙！`，rate `+0%`，pitch `-5Hz`，保留自然男声声区。
- 经 ffmpeg 去除首尾静音，保存为单声道 44.1kHz、16bit PCM WAV。
- 重新混音：`python3 scripts/generate-stalemate-feedback.py`。使用已保存的素材，构建与离线播放无需联网合成。
- 输出独立资源 `v109-stalemate-male-v4.wav`，避免复用旧资源 URL。图文保持“困毙”。
