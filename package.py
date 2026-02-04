#!/usr/bin/env python3
"""ZDFTranslate 打包脚本 - 修复版"""

import json
import os
import zipfile
from pathlib import Path

def get_version():
    """从 manifest.json 读取版本号"""
    with open('manifest.json', 'r') as f:
        manifest = json.load(f)
        return manifest.get('version', '1.0.0')

def create_package():
    version = get_version()
    zip_name = f"zdf-translate-v{version}.zip"
    
    # 清理旧文件
    if os.path.exists(zip_name):
        os.remove(zip_name)
    
    print(f"🚀 开始打包 ZDFTranslate v{version}...")
    
    # 要包含的文件和目录
    includes = [
        'manifest.json',
        'README.md',
        'PRIVACY.md',
        'PUBLISH.md',
        'content.js',
        'background.js',
        'popup.js',
        'popup.html',
        'options.js',
        'options.html',
        'lib/',
        'styles/',
        'icons/',
        'screenshots/'
    ]
    
    # 创建 zip - 文件放在根目录
    with zipfile.ZipFile(zip_name, 'w', zipfile.ZIP_DEFLATED) as zf:
        for item in includes:
            if os.path.isfile(item):
                zf.write(item, item)  # 直接放根目录
                print(f"  ✓ {item}")
            elif os.path.isdir(item):
                for root_dir, dirs, files in os.walk(item):
                    for file in files:
                        if file.endswith(('.js', '.css', '.html', '.png', '.md')):
                            file_path = os.path.join(root_dir, file)
                            arc_name = file_path  # 保持相对路径，直接放根目录
                            zf.write(file_path, arc_name)
                            print(f"  ✓ {file_path}")
    
    # 显示文件大小
    size = os.path.getsize(zip_name)
    size_mb = size / (1024 * 1024)
    
    print(f"\n✅ 打包完成: {zip_name}")
    print(f"📦 文件大小: {size_mb:.2f} MB ({size:,} bytes)")
    print(f"💡 解压后直接加载文件夹即可，无需进入子目录")
    print(f"\n下一步：访问 https://chrome.google.com/webstore/devconsole 上传此文件")

if __name__ == '__main__':
    os.chdir('/root/.openclaw/workspace/zdf-translate')
    create_package()
