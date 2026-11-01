# 困毙发声素材 v3

两个合成普通话单字，仅供本项目困毙提示混音。非参考视频采样、非真人声纹克隆。

- 语音：Microsoft Edge `zh-CN-YunxiNeural`。
- 输入：`困！`、`毙！`，分别生成，rate `-10%`，pitch 分别 `+90Hz`、`+120Hz`。
- 经 ffmpeg 去除首尾静音，保留为单声道 44.1kHz、16bit PCM WAV。
- 构建与离线播放不访问语音服务；重新混音运行 `python3 scripts/generate-stalemate-feedback.py`。
- 主音效保留双字，第二字重读；画面文案始终为“困毙”。
