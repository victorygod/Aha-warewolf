#!/bin/bash
# 停止占用3000端口的进程

PID=$(lsof -ti :3000)
if [ -n "$PID" ]; then
    echo "正在Kill进程: $PID"
    kill -9 $PID
    echo "已停止占用3000端口的进程"
else
    echo "没有进程占用3000端口"
fi