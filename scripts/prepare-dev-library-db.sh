#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="$HOME/Library/Application Support"
SHARED_DIR="$DATA_ROOT/cn.xiangqi.studio"

echo "正式版和开发版已统一使用同一个数据库目录：$SHARED_DIR"
echo "不再需要复制正式库到 dev 库；本脚本保留为兼容入口，不执行任何数据库写入。"
