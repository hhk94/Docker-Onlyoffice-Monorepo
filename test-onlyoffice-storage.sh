#!/bin/bash

# OnlyOffice 文件存储路径测试脚本
echo "========= OnlyOffice 配置测试 ========="
echo "检查配置的存储路径..."

# 检查路径存在性
if [ -d "/data_hekun/onlyoffice_local_url" ]; then
  echo "✓ 主存储路径: /data_hekun/onlyoffice_local_url 存在"
else
  echo "✗ 主存储路径不存在"
fi

if [ -d "/data_hekun/onlyoffice_local_url/cache" ]; then
  echo "✓ 缓存路径: /data_hekun/onlyoffice_local_url/cache 存在"
else
  echo "✗ 缓存路径不存在"
fi

if [ -d "/data_hekun/onlyoffice_local_url/files" ]; then
  echo "✓ 文件路径: /data_hekun/onlyoffice_local_url/files 存在"
else
  echo "✗ 文件路径不存在"
fi

if [ -d "/data_hekun/onlyoffice_local_url/tmp" ]; then
  echo "✓ 临时文件路径: /data_hekun/onlyoffice_local_url/tmp 存在"
else
  echo "✗ 临时文件路径不存在"
fi

# 检查权限
echo -e "\n检查目录权限..."
echo "主目录权限:"
ls -la /data_hekun/onlyoffice_local_url

echo -e "\n检查是否有文件写入记录..."
find /data_hekun/onlyoffice_local_url -type f -mtime -1 | head -5

echo -e "\n========= 测试完成 ========="
