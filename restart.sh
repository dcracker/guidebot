#!/bin/sh
cd /home/pi/guidebot
if [ -f "save_pid.txt" ]; then
  kill -9 `cat save_pid.txt`
  rm save_pid.txt
fi

nohup node index.js &
echo $! > save_pid.txt
