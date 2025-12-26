


# 0. 目的

onlyoffice希望不存放在根目录，文件访问路径需要加上前缀，比如`/cache/files/data/`需要变成`/xxx/cache/files/data/`

# 1.结论 - 放在最前
1. onlyoffice生成文件路径并不是真实访问路径而是映射路径
2. 本地存储为`/cache/`,minio存储为`/storage-cache/`,两者都为硬编码写在onlyoffice中，无法通过配置修改；
3. 但是两者并不是真实的文件路径，只是映射路径，实际并不影响服务端浏览器的分配，举例`http://localhost:8080/cache/hekun_local/files1_local/data_local/key-1766653764483/Editor.bin/Editor.bin?md5=kVUTCx8G_uy99fZr_fNQLw&expires=1769248358&shardkey=key-1766653764483&filename=Editor.bin`实际存放地址为`/data_hekun/onlyoffice_local_url/data_local/key-1766653764483/Editor.bin/Editor.bin`和`cache/hekun_local/files1_local/`无关。
4. **onlyoffice自己处理了文件夹之间的映射关系**
5. 如果必须要修改`/cache/`开头，仅能通过nginx反向代理重写。
# 2. 方案
## 2.1 方案1 - Nginx 反向代理重写
### 2.1.1 配置Nginx
替换OnlyOffice响应中的路径 → 给前端返回带前缀的路径,比如把`/cache/files/data/`替换成`/hekun/nginxTest/cache/files/data/`
再把替换后路径请求代理到真实路径

```nginx
server {
    listen 80;
    server_name localhost;
    # 重写重定向URL，添加正确的端口信息
    proxy_redirect http://localhost/ http://localhost:8080/;
    proxy_redirect http://localhost:80/ http://localhost:8080/;
    proxy_redirect ~^http://localhost(:80)?/(cache/files/data/.*)$ http://localhost:8080/hekun/nginxTest/$1;
    
    # WebSocket 支持
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # 添加关键的反向代理头部，告诉OnlyOffice正确的外部访问URL
    proxy_set_header Host $host:8080;  # 明确指定端口号
    proxy_set_header X-Forwarded-Host $host:8080;
    proxy_set_header X-Forwarded-Port 8080;
    # 确保替换所有响应内容中的URL
    proxy_buffer_size 128k;
    proxy_buffers 4 256k;
    proxy_busy_buffers_size 256k;

    # 1. 处理客户端带前缀的请求 → 转发到实际路径
    location ^~ /hekun/nginxTest/cache/files/data/ {
        # 添加特定的日志标记
        access_log /var/log/nginx/access_xxx_cache.log combined;
        
        rewrite ^/hekun/nginxTest/(cache/files/data/.*)$ /$1 break; # 去掉前缀转发到实际路径
        proxy_pass http://onlyoffice; # 使用容器名称访问OnlyOffice服务
        proxy_set_header Host $host:8080;  # 明确指定端口号
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Host $host:8080;
        proxy_set_header X-Forwarded-Port 8080;
        # 为直接访问带前缀的请求也添加替换规则
        sub_filter_types *;
        sub_filter 'http://localhost/cache/files/data/' 'http://localhost:8080/hekun/nginxTest/cache/files/data/';
        sub_filter 'http://localhost:80/cache/files/data/' 'http://localhost:8080/hekun/nginxTest/cache/files/data/';
        sub_filter 'http://localhost:8080/cache/files/data/' 'http://localhost:8080/hekun/nginxTest/cache/files/data/';
        sub_filter '/cache/files/data/' '/hekun/nginxTest/cache/files/data/';
        sub_filter_once off;
    }

    # 2. 直接处理不带前缀的/cache/files/data/请求
    location ^~ /cache/files/data/ {
        # 添加特定的日志标记
        access_log /var/log/nginx/access_cache.log combined;
        
        # 重定向到带前缀的URL
        return 301 http://$host:8080/hekun/nginxTest$request_uri;
    }

    # 3. 替换OnlyOffice响应中的路径 → 给前端返回带前缀的路径
    location / {
        # 添加特定的日志标记
        access_log /var/log/nginx/access_root.log combined;
        
        proxy_pass http://onlyoffice; # 使用容器名称访问OnlyOffice服务
        proxy_set_header Host $host:8080;  # 明确指定端口号
        proxy_set_header X-Real-IP $remote_addr;
        # 确保OnlyOffice能够正确识别请求来源
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host:8080;
        proxy_set_header X-Forwarded-Port 8080;
        
        # 增强buffer大小以确保能处理大型响应
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
        
        # 使用更强大的替换规则，覆盖所有可能的URL格式
        sub_filter_types *;
        # 按优先级顺序匹配不同格式的URL
        sub_filter 'http://localhost/cache/files/data/' 'http://localhost:8080/hekun/nginxTest/cache/files/data/';
        sub_filter 'http://localhost:80/cache/files/data/' 'http://localhost:8080/hekun/nginxTest/cache/files/data/';
        sub_filter 'http://localhost:8080/cache/files/data/' 'http://localhost:8080/hekun/nginxTest/cache/files/data/';
        # 匹配相对路径
        sub_filter '/cache/files/data/' '/hekun/nginxTest/cache/files/data/';
        # 匹配可能的JavaScript字符串中的路径
        sub_filter '"/cache/files/data/' '"/hekun/nginxTest/cache/files/data/';
        sub_filter "'/cache/files/data/" "'/hekun/nginxTest/cache/files/data/";
        sub_filter_once off; # 替换所有匹配项
    }
}
```

### 2.1.2 配置docker-compose.yml
在docker-compose.yml中添加以下内容：

```yaml
nginx-proxy:
    image: nginx:alpine
    container_name: nginx-proxy
    restart: unless-stopped
    ports:
      - "8080:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf
    networks:
      - onlyoffice-network
    depends_on:
      - onlyoffice
```

onlyoffice不指定端口号，由nginx代理

### 2.1.3 成功展示
![alt text](image-1.png)
![alt text](image-2.png)

## 2.2 onlyoffice - 存储本地
### 2.2.1 检查cache/files/data/是存在minio还是存在本地

```bash
docker exec -it onlyoffice ls -la /var/lib/onlyoffice/documentserver/App_Data
docker exec -it onlyoffice ls -la /var/lib/onlyoffice/documentserver/App_Data/cache/files
docker exec -it onlyoffice ls -la /var/lib/onlyoffice/documentserver/App_Data/cache/files/data
docker exec -it onlyoffice ls -la /var/lib/onlyoffice/documentserver/App_Data/cache/files/data/key-1766561666273
```

### 2.2.2 onlyoffice local.json配置

```json

{
  "services": {
    "CoAuthoring": {
      
      "sql": {
        "type": "postgres",
        "dbHost": "postgres",
        "dbPort": "5432",
        "dbName": "onlyoffice",
        "dbUser": "onlyoffice",
        "dbPass": "onlyoffice_pass"
      },
      "converter": {
        "maxDownloadBytes": 104857600,
        "maxUploadBytes": 104857600,
        "allowPrivateIPAddress": true
      },
      "requests": {
        "restrictions": {
          "ip": {
            "allow": [
              "172.20.0.0/16",
              "127.0.0.1",
              "node-backend",
              "172.20.0.6",
              "localhost"
            ],
            "deny": []
          },
          "networks": {
            "allow": ["172.20.0.0/16"],
            "deny": []
          }
        }
      },
      "request-filtering-agent": {
        "allowPrivateIPs": true,
        "allowInternalUrls": true,
        "allowedUrls": [
          "http://localhost:8000",
          "http://127.0.0.1:8000",
          "http://172.18.127.227:8000",
          "http://172.18.127.227:8080",
          "http://localhost:8080",
          "http://localhost:8000",
          "http://localhost",
          "http://127.0.0.1:8080",
          "http://node-backend:8000",
          "http://172.20.0.6:8000",
          "http://172.20.0.6:8080",
          "http://172.20.0.6"
        ],
        "denyPrivateIPAddress": false
      },
      "server": {
        "allowPrivateIPAddress": true,
        "allowPrivateHost": true,
        "rejectUnknownHost": false,
        "commandUrl": "",
        "fileUrl": ""
      },
      "token": {
        "enable": {
          "request": {
            "inbox": true,
            "outbox": true
          },
          "browser": true
        },
        "inbox": {
          "header": "AuthorizationJwt",
          "inBody": false
        },
        "outbox": {
          "header": "AuthorizationJwt",
          "inBody": false
        }
      },
      "secret": {
        "browser": {
          "string": "my_secret_key_for_onlyoffice"
        },
        "inbox": {
          "string": "my_secret_key_for_onlyoffice"
        },
        "outbox": {
          "string": "my_secret_key_for_onlyoffice"
        },
        "session": {
          "string": "my_secret_key_for_onlyoffice"
        }
      },
      "algo": "HS256"
    }
  },
  "rabbitmq": {
    "url": "amqp://guest:guest@rabbitmq:5672"
  },
  "wopi": {
    "enable": false,
    "privateKey": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCMJSK9QD6PqkG+\nvPj0it4IEku3vvhzvwr7ippB+VpBqQ88Ez/XOftbv8JeRhKhwxBpJB3X6KgNMA79\nPr2GE2garo7myNtoyr12xIHjLGJTPtl3Op/K7tKT70UTECvBgrBzJw6N0PyIwngK\naOFDcfd2fT9z18uewUtBfLXi6sm/nZMDMsz6I4Ly8ra7xJ7SvIzt9n9Sy7ZW3Epa\nrvJtiscjZk15+0BMR5F/MCXgth6QBIjSTUlqj05vVPolwTR9bwGWE0xF+kd0WRaR\npBJgZPXp6BQuGYjzTWtJLYEw1YHKkaysDgs3VR6/BxlR2H1JUkoQf0coi+Ssdm5l\n5F802ee1AgMBAAECggEAAPJUmb1QBDMSM/JIJt6z6+Szvjn7/kwmttbo09PrWCYx\nhCZdIrGxkPJqowMLfSw5dXxY90G1tjZs435Y/rQthStIq9EPf6sJkekh4iGanb/+\n7V89VRGSj+KTL4hxwzeEGZhZ8NCd5A6W4PsfCmWVVlI3litkT140M+0JDXn92DLQ\nYXX8iHrD7jO9P2Oa7pmwb6ngvGyix6AGIz+6FX35CtSe/WczqtD1SsM3AYgdj1eH\nCpyKFk+8A0I/sMsG34qryvzZKld42CgqkLZC5AAD3Zzz3c1FnXulj3y+I8hcQfz2\nGEUTZQ1KrqbBqp5YW0cMs3024/dq6NdDzatsZ0tUwQKBgQDCVd95Y6TyhyBZzD4v\nrldyK5atM5tT/WewRh01OnDb62SsSHtmAnisBKV48nQVVujqB5EktY0fZJN7HGEA\nPQAWteEKKd+kWx5dQ0XKqtbJmaIkmJqVz9VCdohqQLTk65FtVCwhcon9Fmw6xkec\nkgXy1pBLh24gYuwuAaqzdu0ltwKBgQC4nU5RZAIutH6iEPWrjayZ+himYXreV9WC\nmON5aQtYP4a+3bnWCXJNvI/SSDY5WBftv2k7u6p6a2AtFa8MNkmE54lNX5dAnUV8\np1YHLCoCgSY8pEJfChCdweQmDkvFJscjpLMSLUOTCnjB/a4AKcMZnRETnwKoYPUP\nRdQ7IlG98wKBgGUrW2nQjCCOZDMbdwxPkMqpEoocobJ5668C8VWylOqIgyKFoWgb\nxUKYMKTkY7ZwRlT/l3oq4csECxs+TOlY2GD6Uqt93SWtIgOfcAfwJF1Tk+vFXkS7\nq+Qr3RyjjwjV8iGeflLzVA7jy3hVnRZPlrUzKm+Hk7dciGPzDjDbqt3FAoGALuY/\nhCu85jKSTQez8X4PUBqZ8oKnHR8BLak7eJd3+1ZAG/LmB/rkX908SDZyGAVKJurO\niA830tu+VhXBH4AXEz1iwxY6rX6GrZExKKdOkM5QcW1lMxGygPFFzWkqVI5yXpqz\npzV6ijtJzDZu4rm5R6OAOBTYLwBaoSOjM9aXH4MCgYEAntI0KTFFVEggCrtdJ75V\nXUEpLa5CXNhXZT7RdxRY/iTYHkPCg9B5Xoa+Tzv0k6kNOLVE/xGJ673y5d7UtoY3\n/GcUBOq0jXJc++J9KmSm0I2x+YR5g1gG5LYPjeofcgOQ6LW9x+cTuarXy3zHQ1NL\njWQqMi4Hc+9lEevDTeDenjE=\n-----END PRIVATE KEY-----\n",
    "privateKeyOld": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCMJSK9QD6PqkG+\nvPj0it4IEku3vvhzvwr7ippB+VpBqQ88Ez/XOftbv8JeRhKhwxBpJB3X6KgNMA79\nPr2GE2garo7myNtoyr12xIHjLGJTPtl3Op/K7tKT70UTECvBgrBzJw6N0PyIwngK\naOFDcfd2fT9z18uewUtBfLXi6sm/nZMDMsz6I4Ly8ra7xJ7SvIzt9n9Sy7ZW3Epa\nrvJtiscjZk15+0BMR5F/MCXgth6QBIjSTUlqj05vVPolwTR9bwGWE0xF+kd0WRaR\npBJgZPXp6BQuGYjzTWtJLYEw1YHKkaysDgs3VR6/BxlR2H1JUkoQf0coi+Ssdm5l\n5F802ee1AgMBAAECggEAAPJUmb1QBDMSM/JIJt6z6+Szvjn7/kwmttbo09PrWCYx\nhCZdIrGxkPJqowMLfSw5dXxY90G1tjZs435Y/rQthStIq9EPf6sJkekh4iGanb/+\n7V89VRGSj+KTL4hxwzeEGZhZ8NCd5A6W4PsfCmWVVlI3litkT140M+0JDXn92DLQ\nYXX8iHrD7jO9P2Oa7pmwb6ngvGyix6AGIz+6FX35CtSe/WczqtD1SsM3AYgdj1eH\nCpyKFk+8A0I/sMsG34qryvzZKld42CgqkLZC5AAD3Zzz3c1FnXulj3y+I8hcQfz2\nGEUTZQ1KrqbBqp5YW0cMs3024/dq6NdDzatsZ0tUwQKBgQDCVd95Y6TyhyBZzD4v\nrldyK5atM5tT/WewRh01OnDb62SsSHtmAnisBKV48nQVVujqB5EktY0fZJN7HGEA\nPQAWteEKKd+kWx5dQ0XKqtbJmaIkmJqVz9VCdohqQLTk65FtVCwhcon9Fmw6xkec\nkgXy1pBLh24gYuwuAaqzdu0ltwKBgQC4nU5RZAIutH6iEPWrjayZ+himYXreV9WC\nmON5aQtYP4a+3bnWCXJNvI/SSDY5WBftv2k7u6p6a2AtFa8MNkmE54lNX5dAnUV8\np1YHLCoCgSY8pEJfChCdweQmDkvFJscjpLMSLUOTCnjB/a4AKcMZnRETnwKoYPUP\nRdQ7IlG98wKBgGUrW2nQjCCOZDMbdwxPkMqpEoocobJ5668C8VWylOqIgyKFoWgb\nxUKYMKTkY7ZwRlT/l3oq4csECxs+TOlY2GD6Uqt93SWtIgOfcAfwJF1Tk+vFXkS7\nq+Qr3RyjjwjV8iGeflLzVA7jy3hVnRZPlrUzKm+Hk7dciGPzDjDbqt3FAoGALuY/\nhCu85jKSTQez8X4PUBqZ8oKnHR8BLak7eJd3+1ZAG/LmB/rkX908SDZyGAVKJurO\niA830tu+VhXBH4AXEz1iwxY6rX6GrZExKKdOkM5QcW1lMxGygPFFzWkqVI5yXpqz\npzV6ijtJzDZu4rm5R6OAOBTYLwBaoSOjM9aXH4MCgYEAntI0KTFFVEggCrtdJ75V\nXUEpLa5CXNhXZT7RdxRY/iTYHkPCg9B5Xoa+Tzv0k6kNOLVE/xGJ673y5d7UtoY3\n/GcUBOq0jXJc++J9KmSm0I2x+YR5g1gG5LYPjeofcgOQ6LW9x+cTuarXy3zHQ1NL\njWQqMi4Hc+9lEevDTeDenjE=\n-----END PRIVATE KEY-----\n",
    "publicKey": "BgIAAACkAABSU0ExAAgAAAEAAQC159k0X+Rlbnas5IsoR38QSlJJfdhRGQe/HlU3Cw6srJHKgdUwgS1Ja03ziBkuFOjp9WRgEqSRFll0R/pFTBOWAW99NMEl+lRvTo9qSU3SiASQHrbgJTB/kUdMQPt5TWYjx4pt8q5aStxWtstSf/btjLzSnsS7tvLygiP6zDIDk52/yeritXxBS8Gey9dzP31293FD4WgKeMKI/NCNDidzsILBKxATRe+T0u7Knzp32T5TYizjgcR2vcpo28jmjq4aaBOGvT79DjANqOjXHSRpEMOhEkZewr9b+znXPxM8D6lBWvlBmor7Cr9z+L63SxII3or0+Ly+QaqPPkC9IiWM",
    "publicKeyOld": "BgIAAACkAABSU0AxAAgAAAEAAQC159k0X+Rlbnas5IsoR38QSlJJfdhRGQe/HlU3Cw6srJHKgdUwgS1Ja03ziBkuFOjp9WRgEqSRFll0R/pFTBOWAW99NMEl+lRvTo9qSU3SiASQHrbgJTB/kUdMQPt5TWYjx4pt8q5aStxWtstSf/btjLzSnsS7tvLygiP6zDIDk52/yeritXxBS8Gey9dzP31293FD4WgKeMKI/NCNDidzsILBKxATRe+T0u7Knzp32T5TYizjgcR2vcpo28jmjq4aaBOGvT79DjANqOjXHSRpEMOhEkZewr9b+znXPxM8D6lBWvlBmor7Cr9z+L63SxII3or0+Ly+QaqPPkC9IiWM",
    "modulus": "jCUivUA+j6pBvrz49IreCBJLt774c78K+4qaQflaQakPPBM/1zn7W7/CXkYSocMQaSQd1+ioDTAO/T69hhNoGq6O5sjbaMq9dsSB4yxiUz7Zdzqfyu7Sk+9FExArwYKwcycOjdD8iMJ4CmjhQ3H3dn0/c9fLnsFLQXy14urJv52TAzLM+iOC8vK2u8Se0ryM7fZ/Usu2VtxKWq7ybYrHI2ZNeftATEeRfzAl4LYekASI0k1Jao9Ob1T6JcE0fW8BlhNMRfpHdFkWkaQSYGT16egULhmI801rSS2BMNWBypGsrA4LN1UevwcZUdh9SVJKEH9HKIvkrHZuZeRfNNnntQ==",
    "modulusOld": "jCUivUA+j6pBvrz49IreCBJLt774c78K+4qaQflaQakPPBM/1zn7W7/CXkYSocMQaSQd1+ioDTAO/T69hhNoGq6O5sjbaMq9dsSB4yxiUz7Zdzqfyu7Sk+9FExArwYKwcycOjdD8iMJ4CmjhQ3H3dn0/c9fLnsFLQXy14urJv52TAzLM+iOC8vK2u8Se0ryM7fZ/Usu2VtxKWq7ybYrHI2ZNeftATEeRfzAl4LYekASI0k1Jao9Ob1T6JcE0fW8BlhNMRfpHdFkWkaQSYGT16egULhmI801rSS2BMNWBypGsrA4LN1UevwcZUdh9SVJKEH9HKIvkrHZuZeRfNNnntQ==",
    "exponent": 65537,
    "exponentOld": 65537
  },
  "queue": {
    "type": "rabbitmq"
  },
  "storage": {
    "type": "fs",
    "fs": {
      "folderPath": "/data_hekun/onlyoffice_local_url",
      "url": "http://localhost:8080/data_hekun/onlyoffice_local_url"
    },
    "storageFolderName": "hekun_local/files1_local",
    "cacheFolderName": "data_local",
    "useRequestToGetUrl": true,
    "useSignedUrl": false
  },
  "cache": {
    "enable": true,
    "flushInterval": "PT1H",
    "inMemory": false
  }
}


```
**注意**
1. 部分资料和AI智能体说`storage.fs.url` 属性能修改onlyoffice返回的临时路径的url，但是实际测试中发现并不能修改。这里未删除是为了在次特别提出提醒。
2. `storage.fs.folderPath` 是onlyoffice存储文件的本地路径，可以改变onlyoffice文件在服务器上的存储磁盘地址，默认是`/var/lib/onlyoffice/documentserver/App_Data`，在这里被我修改为`/data_hekun/onlyoffice_local_url`。
3. `storage.storageFolderName` 是onlyoffice存储文件的本地路径下的文件夹名称,默认为`files`，这个支持修改，且可以改为多路径，比如我这里的`hekun_local/files1_local`，你可以写成`test_files`等，如果有需要，可以拼接更长的路径名，这些路径名会被onlyoffice处理到返回的临时URL上，稍后我会举出成功的示例。
4. `storage.storageFolderName`并不代表文件的真实存储地址，只是一个路径名。比如我这里`hekun_local/files1_local`，但实际onlyoffice文件会被存储在`/data_hekun/onlyoffice_local_url/data_local`下。
5. `storage.cacheFolderName` 是onlyoffice缓存文件的本地路径下的文件夹名称,这个支持修改，默认是`data`，在这里我修改为`data_local`。这个会影响到真实的路径存储，这也就是我第4点所说的：实际onlyoffice文件会被存储在`/data_hekun/onlyoffice_local_url/data_local`下。
6. 经过多轮测试验证，onlyoffice返回的临时路径的url中，`/cache/`后面的路径名，就是`storage.cacheFolderName`和`storage.storageFolderName`拼接起来的路径名。而`/cache/`本身为硬编码，无法从配置层面修改。

完整的bin文件url示例如下：
`http://localhost:8080/cache/hekun_local/files1_local/data_local/key-1766653764483/Editor.bin/Editor.bin?md5=kVUTCx8G_uy99fZr_fNQLw&expires=1769248358&shardkey=key-1766653764483&filename=Editor.bin`

实际的bin文件存放目录为：
`/data_hekun/onlyoffice_local_url/data_local/key-1766653764483/Editor.bin/Editor.bin`
![alt text](image-6.png)
### 2.2.3 docker容器相关配置

```yaml
services:
  # MinIO 服务
  minio:
    image: minio/minio:RELEASE.2023-12-02T10-51-33Z
    container_name: minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    ports:
      - "${MINIO_PORT}:9000"      # API端口
      - "${MINIO_CONSOLE_PORT}:9001"  # 控制台端口
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
      MINIO_REGION: ${MINIO_REGION}
    volumes:
    - ./minio/data:/data
    - ./minio/config:/root/.minio  # 添加配置目录
    networks:
      - onlyoffice-network

  # PostgreSQL 数据库
  postgres:
    image: postgres:13-alpine
    container_name: postgres
    restart: unless-stopped
    ports:
      - "${POSTGRES_EXTERNAL_PORT}:${POSTGRES_INTERNAL_PORT}"
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./postgres/data:/var/lib/postgresql/data
    networks:
      - onlyoffice-network

  # RabbitMQ 消息队列
  rabbitmq:
    image: rabbitmq:3-management-alpine
    container_name: rabbitmq
    restart: unless-stopped
    ports:
      - "${RABBITMQ_AMQP_EXTERNAL_PORT}:${RABBITMQ_AMQP_INTERNAL_PORT}"
      - "${RABBITMQ_MANAGEMENT_EXTERNAL_PORT}:${RABBITMQ_MANAGEMENT_INTERNAL_PORT}"
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_DEFAULT_USER}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_DEFAULT_PASS}
    volumes:
      - ./rabbitmq/data:/var/lib/rabbitmq
    networks:
      - onlyoffice-network

  # Redis 缓存
  redis:
    image: redis:7-alpine
    container_name: redis
    restart: unless-stopped
    ports:
      - "${REDIS_EXTERNAL_PORT}:${REDIS_INTERNAL_PORT}"
    command: redis-server --appendonly yes
    volumes:
      - ./redis/data:/data
    networks:
      - onlyoffice-network

  # OnlyOffice Document Server
  onlyoffice:
    image: onlyoffice/documentserver:latest
    container_name: onlyoffice
    restart: unless-stopped
    user: "root:root"
    ports:
      - "${ONLYOFFICE_PORT}:80"
    environment:
      JWT_ENABLED: ${ONLYOFFICE_JWT_ENABLED}
      JWT_SECRET: ${ONLYOFFICE_JWT_SECRET}
      JWT_HEADER: ${ONLYOFFICE_JWT_HEADER}
      DB_TYPE: postgres
      DB_HOST: postgres
      DB_NAME: ${POSTGRES_DB}
      DB_USER: ${POSTGRES_USER}
      DB_PWD: ${POSTGRES_PASSWORD}
      AMQP_URI: amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@rabbitmq:${RABBITMQ_AMQP_INTERNAL_PORT}
      AMQP_TYPE: rabbitmq
      REDIS_SERVER_HOST: redis
      REDIS_SERVER_PORT: ${REDIS_INTERNAL_PORT}
      # 移除S3存储配置，统一使用本地文件系统
      # 允许私有IP访问
      SERVICES_COAUTHORING_ALLOW_PRIVATE_IP_ADDRESS: "true"
      SERVICES_COAUTHORING_ALLOW_PRIVATE_HOST: "true"
      SERVICES_COAUTHORING_REQUEST_FILTERING_ALLOW_PRIVATE_IPS: "true"
      SERVICES_COAUTHORING_REQUEST_FILTERING_ALLOW_INTERNAL_URLS: "true"
      SERVICES_COAUTHORING_SERVER_REJECT_UNKNOWN_HOST: "false"
      SERVICES_COAUTHORING_CONVERTER_ALLOW_PRIVATE_IP_ADDRESS: "true"
      #   # 存储配置环境变量
      STORAGE_TYPE: fs
      FS_FOLDER_PATH: /data_hekun/onlyoffice_local_url
      CACHE_ENABLED: true
      CACHE_FLUSH_INTERVAL: PT1H
      STORAGE_PATH: /var/www/onlyoffice/Data
      CACHE_PATH: /var/www/onlyoffice/Data/cache
      FILES_PATH: /var/www/onlyoffice/Data/cache/files
      TMP_PATH: /var/www/onlyoffice/Data/tmp
    volumes:
      - ./onlyoffice/data:/var/www/onlyoffice/Data
      - ./onlyoffice/logs:/var/log/onlyoffice
      - ./onlyoffice-config/local.json:/etc/onlyoffice/documentserver/local.json
      - ./data_hekun/onlyoffice_local_url:/data_hekun/onlyoffice_local_url
    networks:
      - onlyoffice-network
    depends_on:
      - postgres
      - rabbitmq
      - redis
      - minio

  # Node.js 后端服务
  node-backend:
    build: ./node
    container_name: node-backend
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      MINIO_PORT: "9000"
      MINIO_BUCKET_NAME: ${MINIO_BUCKET_NAME}
      MINIO_REGION: ${MINIO_REGION}
      MINIO_ACCESS_KEY: ${MINIO_ACCESS_KEY}
      MINIO_SECRET_KEY: ${MINIO_SECRET_KEY}
      SERVER_BASE_URL: "http://node-backend:8000"
      HOST_IP: ${HOST_IP}
    volumes:
      - ./node/temp_uploads:/app/temp_uploads
      - ./node/uploads:/app/uploads
    networks:
      - onlyoffice-network
    depends_on:
      - minio

networks:
  onlyoffice-network:
    driver: bridge
```

**注意：**
1. 在onlyoffice的volumes中添加`- ./data_hekun/onlyoffice_local_url:/data_hekun/onlyoffice_local_url`，将本地路径挂载到容器中。
2. 需要添加操作权限账户`user: "root:root"`，因为会对本地磁盘有读写操作。
3. 存储配置环境变量 下的配置，经过测试也都是无效的，在这作为记录。

## 2.3 onlyoffice - 存储minio

### 2.3.1 配置minio存储 
```json
{
  "services": {
    "CoAuthoring": {
     
      "sql": {
        "type": "postgres",
        "dbHost": "postgres",
        "dbPort": "5432",
        "dbName": "onlyoffice",
        "dbUser": "onlyoffice",
        "dbPass": "onlyoffice_pass"
      },
      "converter": {
        "maxDownloadBytes": 104857600,
        "maxUploadBytes": 104857600,
        "allowPrivateIPAddress": true
      },
      "requests": {
        "restrictions": {
          "ip": {
            "allow": [
              "172.20.0.0/16",
              "127.0.0.1",
              "node-backend",
              "172.20.0.6",
              "localhost"
            ],
            "deny": []
          },
          "networks": {
            "allow": ["172.20.0.0/16"],
            "deny": []
          }
        }
      },
      "request-filtering-agent": {
        "allowPrivateIPs": true,
        "allowInternalUrls": true,
        "allowedUrls": [
          "http://localhost:8000",
          "http://127.0.0.1:8000",
          "http://172.18.127.227:8000",
          "http://172.18.127.227:8080",
          "http://localhost:8080",
          "http://localhost:8000",
          "http://localhost",
          "http://127.0.0.1:8080",
          "http://node-backend:8000",
          "http://172.20.0.6:8000",
          "http://172.20.0.6:8080",
          "http://172.20.0.6"
        ],
        "denyPrivateIPAddress": false
      },
      "server": {
        "allowPrivateIPAddress": true,
        "allowPrivateHost": true,
        "rejectUnknownHost": false,
        "commandUrl": "",
        "fileUrl": ""
      },
      "token": {
        "enable": {
          "request": {
            "inbox": true,
            "outbox": true
          },
          "browser": true
        },
        "inbox": {
          "header": "AuthorizationJwt",
          "inBody": false
        },
        "outbox": {
          "header": "AuthorizationJwt",
          "inBody": false
        }
      },
      "secret": {
        "browser": {
          "string": "my_secret_key_for_onlyoffice"
        },
        "inbox": {
          "string": "my_secret_key_for_onlyoffice"
        },
        "outbox": {
          "string": "my_secret_key_for_onlyoffice"
        },
        "session": {
          "string": "my_secret_key_for_onlyoffice"
        }
      },
      "algo": "HS256"
    }
  },
  "rabbitmq": {
    "url": "amqp://guest:guest@rabbitmq:5672"
  },
  "wopi": {
    "enable": false,
    "privateKey": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCMJSK9QD6PqkG+\nvPj0it4IEku3vvhzvwr7ippB+VpBqQ88Ez/XOftbv8JeRhKhwxBpJB3X6KgNMA79\nPr2GE2garo7myNtoyr12xIHjLGJTPtl3Op/K7tKT70UTECvBgrBzJw6N0PyIwngK\naOFDcfd2fT9z18uewUtBfLXi6sm/nZMDMsz6I4Ly8ra7xJ7SvIzt9n9Sy7ZW3Epa\nrvJtiscjZk15+0BMR5F/MCXgth6QBIjSTUlqj05vVPolwTR9bwGWE0xF+kd0WRaR\npBJgZPXp6BQuGYjzTWtJLYEw1YHKkaysDgs3VR6/BxlR2H1JUkoQf0coi+Ssdm5l\n5F802ee1AgMBAAECggEAAPJUmb1QBDMSM/JIJt6z6+Szvjn7/kwmttbo09PrWCYx\nhCZdIrGxkPJqowMLfSw5dXxY90G1tjZs435Y/rQthStIq9EPf6sJkekh4iGanb/+\n7V89VRGSj+KTL4hxwzeEGZhZ8NCd5A6W4PsfCmWVVlI3litkT140M+0JDXn92DLQ\nYXX8iHrD7jO9P2Oa7pmwb6ngvGyix6AGIz+6FX35CtSe/WczqtD1SsM3AYgdj1eH\nCpyKFk+8A0I/sMsG34qryvzZKld42CgqkLZC5AAD3Zzz3c1FnXulj3y+I8hcQfz2\nGEUTZQ1KrqbBqp5YW0cMs3024/dq6NdDzatsZ0tUwQKBgQDCVd95Y6TyhyBZzD4v\nrldyK5atM5tT/WewRh01OnDb62SsSHtmAnisBKV48nQVVujqB5EktY0fZJN7HGEA\nPQAWteEKKd+kWx5dQ0XKqtbJmaIkmJqVz9VCdohqQLTk65FtVCwhcon9Fmw6xkec\nkgXy1pBLh24gYuwuAaqzdu0ltwKBgQC4nU5RZAIutH6iEPWrjayZ+himYXreV9WC\nmON5aQtYP4a+3bnWCXJNvI/SSDY5WBftv2k7u6p6a2AtFa8MNkmE54lNX5dAnUV8\np1YHLCoCgSY8pEJfChCdweQmDkvFJscjpLMSLUOTCnjB/a4AKcMZnRETnwKoYPUP\nRdQ7IlG98wKBgGUrW2nQjCCOZDMbdwxPkMqpEoocobJ5668C8VWylOqIgyKFoWgb\nxUKYMKTkY7ZwRlT/l3oq4csECxs+TOlY2GD6Uqt93SWtIgOfcAfwJF1Tk+vFXkS7\nq+Qr3RyjjwjV8iGeflLzVA7jy3hVnRZPlrUzKm+Hk7dciGPzDjDbqt3FAoGALuY/\nhCu85jKSTQez8X4PUBqZ8oKnHR8BLak7eJd3+1ZAG/LmB/rkX908SDZyGAVKJurO\niA830tu+VhXBH4AXEz1iwxY6rX6GrZExKKdOkM5QcW1lMxGygPFFzWkqVI5yXpqz\npzV6ijtJzDZu4rm5R6OAOBTYLwBaoSOjM9aXH4MCgYEAntI0KTFFVEggCrtdJ75V\nXUEpLa5CXNhXZT7RdxRY/iTYHkPCg9B5Xoa+Tzv0k6kNOLVE/xGJ673y5d7UtoY3\n/GcUBOq0jXJc++J9KmSm0I2x+YR5g1gG5LYPjeofcgOQ6LW9x+cTuarXy3zHQ1NL\njWQqMi4Hc+9lEevDTeDenjE=\n-----END PRIVATE KEY-----\n",
    "privateKeyOld": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCMJSK9QD6PqkG+\nvPj0it4IEku3vvhzvwr7ippB+VpBqQ88Ez/XOftbv8JeRhKhwxBpJB3X6KgNMA79\nPr2GE2garo7myNtoyr12xIHjLGJTPtl3Op/K7tKT70UTECvBgrBzJw6N0PyIwngK\naOFDcfd2fT9z18uewUtBfLXi6sm/nZMDMsz6I4Ly8ra7xJ7SvIzt9n9Sy7ZW3Epa\nrvJtiscjZk15+0BMR5F/MCXgth6QBIjSTUlqj05vVPolwTR9bwGWE0xF+kd0WRaR\npBJgZPXp6BQuGYjzTWtJLYEw1YHKkaysDgs3VR6/BxlR2H1JUkoQf0coi+Ssdm5l\n5F802ee1AgMBAAECggEAAPJUmb1QBDMSM/JIJt6z6+Szvjn7/kwmttbo09PrWCYx\nhCZdIrGxkPJqowMLfSw5dXxY90G1tjZs435Y/rQthStIq9EPf6sJkekh4iGanb/+\n7V89VRGSj+KTL4hxwzeEGZhZ8NCd5A6W4PsfCmWVVlI3litkT140M+0JDXn92DLQ\nYXX8iHrD7jO9P2Oa7pmwb6ngvGyix6AGIz+6FX35CtSe/WczqtD1SsM3AYgdj1eH\nCpyKFk+8A0I/sMsG34qryvzZKld42CgqkLZC5AAD3Zzz3c1FnXulj3y+I8hcQfz2\nGEUTZQ1KrqbBqp5YW0cMs3024/dq6NdDzatsZ0tUwQKBgQDCVd95Y6TyhyBZzD4v\nrldyK5atM5tT/WewRh01OnDb62SsSHtmAnisBKV48nQVVujqB5EktY0fZJN7HGEA\nPQAWteEKKd+kWx5dQ0XKqtbJmaIkmJqVz9VCdohqQLTk65FtVCwhcon9Fmw6xkec\nkgXy1pBLh24gYuwuAaqzdu0ltwKBgQC4nU5RZAIutH6iEPWrjayZ+himYXreV9WC\nmON5aQtYP4a+3bnWCXJNvI/SSDY5WBftv2k7u6p6a2AtFa8MNkmE54lNX5dAnUV8\np1YHLCoCgSY8pEJfChCdweQmDkvFJscjpLMSLUOTCnjB/a4AKcMZnRETnwKoYPUP\nRdQ7IlG98wKBgGUrW2nQjCCOZDMbdwxPkMqpEoocobJ5668C8VWylOqIgyKFoWgb\nxUKYMKTkY7ZwRlT/l3oq4csECxs+TOlY2GD6Uqt93SWtIgOfcAfwJF1Tk+vFXkS7\nq+Qr3RyjjwjV8iGeflLzVA7jy3hVnRZPlrUzKm+Hk7dciGPzDjDbqt3FAoGALuY/\nhCu85jKSTQez8X4PUBqZ8oKnHR8BLak7eJd3+1ZAG/LmB/rkX908SDZyGAVKJurO\niA830tu+VhXBH4AXEz1iwxY6rX6GrZExKKdOkM5QcW1lMxGygPFFzWkqVI5yXpqz\npzV6ijtJzDZu4rm5R6OAOBTYLwBaoSOjM9aXH4MCgYEAntI0KTFFVEggCrtdJ75V\nXUEpLa5CXNhXZT7RdxRY/iTYHkPCg9B5Xoa+Tzv0k6kNOLVE/xGJ673y5d7UtoY3\n/GcUBOq0jXJc++J9KmSm0I2x+YR5g1gG5LYPjeofcgOQ6LW9x+cTuarXy3zHQ1NL\njWQqMi4Hc+9lEevDTeDenjE=\n-----END PRIVATE KEY-----\n",
    "publicKey": "BgIAAACkAABSU0ExAAgAAAEAAQC159k0X+Rlbnas5IsoR38QSlJJfdhRGQe/HlU3Cw6srJHKgdUwgS1Ja03ziBkuFOjp9WRgEqSRFll0R/pFTBOWAW99NMEl+lRvTo9qSU3SiASQHrbgJTB/kUdMQPt5TWYjx4pt8q5aStxWtstSf/btjLzSnsS7tvLygiP6zDIDk52/yeritXxBS8Gey9dzP31293FD4WgKeMKI/NCNDidzsILBKxATRe+T0u7Knzp32T5TYizjgcR2vcpo28jmjq4aaBOGvT79DjANqOjXHSRpEMOhEkZewr9b+znXPxM8D6lBWvlBmor7Cr9z+L63SxII3or0+Ly+QaqPPkC9IiWM",
    "publicKeyOld": "BgIAAACkAABSU0AxAAgAAAEAAQC159k0X+Rlbnas5IsoR38QSlJJfdhRGQe/HlU3Cw6srJHKgdUwgS1Ja03ziBkuFOjp9WRgEqSRFll0R/pFTBOWAW99NMEl+lRvTo9qSU3SiASQHrbgJTB/kUdMQPt5TWYjx4pt8q5aStxWtstSf/btjLzSnsS7tvLygiP6zDIDk52/yeritXxBS8Gey9dzP31293FD4WgKeMKI/NCNDidzsILBKxATRe+T0u7Knzp32T5TYizjgcR2vcpo28jmjq4aaBOGvT79DjANqOjXHSRpEMOhEkZewr9b+znXPxM8D6lBWvlBmor7Cr9z+L63SxII3or0+Ly+QaqPPkC9IiWM",
    "modulus": "jCUivUA+j6pBvrz49IreCBJLt774c78K+4qaQflaQakPPBM/1zn7W7/CXkYSocMQaSQd1+ioDTAO/T69hhNoGq6O5sjbaMq9dsSB4yxiUz7Zdzqfyu7Sk+9FExArwYKwcycOjdD8iMJ4CmjhQ3H3dn0/c9fLnsFLQXy14urJv52TAzLM+iOC8vK2u8Se0ryM7fZ/Usu2VtxKWq7ybYrHI2ZNeftATEeRfzAl4LYekASI0k1Jao9Ob1T6JcE0fW8BlhNMRfpHdFkWkaQSYGT16egULhmI801rSS2BMNWBypGsrA4LN1UevwcZUdh9SVJKEH9HKIvkrHZuZeRfNNnntQ==",
    "modulusOld": "jCUivUA+j6pBvrz49IreCBJLt774c78K+4qaQflaQakPPBM/1zn7W7/CXkYSocMQaSQd1+ioDTAO/T69hhNoGq6O5sjbaMq9dsSB4yxiUz7Zdzqfyu7Sk+9FExArwYKwcycOjdD8iMJ4CmjhQ3H3dn0/c9fLnsFLQXy14urJv52TAzLM+iOC8vK2u8Se0ryM7fZ/Usu2VtxKWq7ybYrHI2ZNeftATEeRfzAl4LYekASI0k1Jao9Ob1T6JcE0fW8BlhNMRfpHdFkWkaQSYGT16egULhmI801rSS2BMNWBypGsrA4LN1UevwcZUdh9SVJKEH9HKIvkrHZuZeRfNNnntQ==",
    "exponent": 65537,
    "exponentOld": 65537
  },
  "queue": {
    "type": "rabbitmq"
  },
  "storage": {
    "type": "minio",
    "endpoint": "http://minio:9000",
    "bucketName": "onlyoffice-documents",
    "accessKeyId": "YEXbqjnJ64BGEQqiMKKk",
    "secretAccessKey": "VateaQYVo9oabIpYrC7WRj3s1vL1xz9xNYJMXxf5",
    "region": "us-east-1",
    "name": "storage-s3",
    "storageFolderName": "hekun-monio/files",
    "cacheFolderName": "minio-data",
    "useRequestToGetUrl": true,
    "useSignedUrl": true,
    "sslEnabled": true,
    "s3ForcePathStyle": true
  },
  "cache": {
    "enable": true,
    "flushInterval": "PT1H",
    "inMemory": false
  }
}



```
在onlyoffice的storage中修改相关配置，重点如下:
```json
 "storage": {
    "type": "minio",
    "endpoint": "http://minio:9000",
    "bucketName": "onlyoffice-documents",
    "accessKeyId": "YEXbqjnJ64BGEQqiMKKk",
    "secretAccessKey": "VateaQYVo9oabIpYrC7WRj3s1vL1xz9xNYJMXxf5",
    "region": "us-east-1",
    "name": "storage-s3",
    "storageFolderName": "hekun-monio/files",
    "cacheFolderName": "minio-data",
    "useRequestToGetUrl": true,
    "useSignedUrl": true,
    "sslEnabled": true,
    "s3ForcePathStyle": true
  },
```
**注意**：
1. endpoint 为 minio 的地址
2. bucketName 为 minio 中的 bucket 名称,桶名
3. accessKeyId 和 secretAccessKey 为 minio 的访问密钥, 可以在 minio 中查看。
4. region 为 S3区域标识，MinIO通常固定为 us-east-1，一般不需要修改
5. name **基本无法修改**，为 OnlyOffice 内置的 S3 协议模块标识，网上给的资料是错的
6. storageFolderName 为 minio 中的存储文件夹名称，会创建文件夹，使用"/"分隔会创建多个文件夹
7. cacheFolderName 为 minio 中的缓存文件夹名称，会创建文件夹，使用"/"分隔会创建多个文件夹，**剩下几个属性基本无用，可不配置**
8. useRequestToGetUrl 为是否使用请求获取 URL
9. useSignedUrl 为是否使用签名 URL
10. sslEnabled 为是否启用 SSL
11. s3ForcePathStyle 为是否强制使用路径样式

完整的bin文件url示例如下：：
`http://localhost:8080/storage-cache/hekun-monio/files/minio-data/key-1766652917365/Editor.bin/Editor.bin?md5=B6N5sbbeTG0AmsA1GvUseQ&expires=1769247511&shardkey=key-1766652917365&filename=Editor.bin`
![alt text](image-5.png)
### 2.3.2 accessKeyId 和 secretAccessKey查看
1. 登录 minio 控制台
2. 点击左侧菜单中的 "Access Keys"
3. 可以查看 accessKeyId 和 secretAccessKey
4. 特别说明，有些minio版本是不支持"Access Keys"菜单的，那就需要更换minio完整版，我这里换成了`minio/minio:RELEASE.2023-12-02T10-51-33Z` 而不是latest版本，就是因为找不到"Access Keys"。这也可能是因为新版支持账号密码连接？并不确定，相关的文档不清晰，需要自己测试。
![alt text](image-4.png)


### 2.3.3 docker容器相关配置
和2.2.3 docker容器相关配置相同，不需要更改。当然也可根据需要删除掉不用的部分，比如`user root`权限，`/data_hekun/onlyoffice_local_url`映射等

# 3.总结
1. onlyoffice临时文件路径由3个部分组成：`http://origin:port`+`/cache`+`storageFolderName`+`cacheFolderName`+`documentKey`
- `http://origin:port`为onlyoffice服务端地址+端口号
- `/cache`和`/storage-cache`为onlyoffice服务端的缓存路径和存储路径，固定不变。
- `storageFolderName`为minio中的存储文件夹名称
- `cacheFolderName`为minio中的缓存文件夹名称
- `documentKey`为onlyoffice生成的文档键值,由前端初始化时传递。
2. `/cache`和`/storage-cache`为硬编码，无法通过配置修改
3. 文件的url路径并非磁盘真实路径，onlyoffice内部自动处理了映射逻辑
- 在fs本地存储模式下，`http://localhost:8080/cache/hekun_local/files1_local/data_local/key-1766653764483/Editor.bin/Editor.bin?md5=kVUTCx8G_uy99fZr_fNQLw&expires=1769248358&shardkey=key-1766653764483&filename=Editor.bin`,真实路径为`/data_hekun/onlyoffice_local_url/data_local/key-1766653764483/Editor.bin/Editor.bin`
- 在minio s3存储模式下，`http://127.0.0.1:9000/onlyoffice-documents/hekun-monio/files/minio-data/key-1766652917365/Editor.bin`

# 4. onlyoffice在Docker容器中部署

## 4.1 服务组成
1. onlyoffice服务端
2. minio存储服务
3. rabbitmq消息队列服务
4. redis缓存服务
5. node-backend后端接口服务
6. postgres数据库服务
7. nginx-proxy代理服务（可能需要）
8. html前端服务

其中`onlyoffice`+`minio`+`rabbitmq`+`postgres`基本算是必须的，`onlyoffice`的组成。
- `minio`和`onlyoffice`能轻松对接S3对象存储，两边同样支持。
- `rabbitmq`不配置的话，使用协同编辑功能时会不停地报websocket错误，心跳失败后会一直弹出错误弹窗，但是不影响文档的正常使用。
- 本身部署完后根据不同端口号已经可以访问，比如`onlyoffice`服务端，默认端口号为8080；`minio`服务端默认端口号为9000。**但是现在的`onlyoffice`服务已经移除的示例，导致部署成功后，无法直接测试文件上传展示等功能，只是基础的api文档，需要自行处理前端及后端服务。**

接下来，我会详细说明整个部署的流程。
## 4.2 部署流程
### 4.2.1 Docker Compose 部署
#### 4.2.1.1 根据电脑系统下载对应版本的Docker Compose，比如Windows系统下载[`docker-compose官网`](https://www.docker.com/products/docker-desktop/)需翻墙
#### 4.2.1.2 运行容器后，修改Docker引擎文件`docker engine`,主要添加`registry-mirrors`镜像加速配置，因为国内下载地址参差不齐，资源可能被墙也可能已经404过期，导致下载失败，AI给的单独的华为云，阿里云等镜像加速地址不够全面，仍然可能导致下载失败，下面是整理的所有镜像，并且实测下载成功，时间为`2025年12月26日10:33:25`
```json
{
  "builder": {
    "gc": {
      "defaultKeepStorage": "20GB",
      "enabled": true
    }
  },
  "experimental": false,
  "registry-mirrors": [
    "https://2a6bf1988cb6428c877f723ec7530dbc.mirror.swr.myhuaweicloud.com",
    "https://docker.m.daocloud.io",
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com",
    "https://your_preferred_mirror",
    "https://dockerhub.icu",
    "https://docker.registry.cyou",
    "https://docker-cf.registry.cyou",
    "https://dockercf.jsdelivr.fyi",
    "https://docker.jsdelivr.fyi",
    "https://dockertest.jsdelivr.fyi",
    "https://mirror.aliyuncs.com",
    "https://dockerproxy.com",
    "https://mirror.baidubce.com",
    "https://docker.m.daocloud.io",
    "https://docker.nju.edu.cn",
    "https://docker.mirrors.sjtug.sjtu.edu.cn",
    "https://docker.mirrors.ustc.edu.cn",
    "https://mirror.iscas.ac.cn",
    "https://docker.rainbond.cc"
  ]
}
```
#### 4.2.1.3 编写`docker-compose.yml`文件，内容如下：
```yaml

services:
  # 反向代理服务
  # nginx-proxy:
  #   image: nginx:alpine
  #   container_name: nginx-proxy
  #   restart: unless-stopped
  #   ports:
  #     - "8080:80"
  #   volumes:
  #     - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf
  #   networks:
  #     - onlyoffice-network
  #   depends_on:
  #     - onlyoffice
  # MinIO 服务
  minio:
    image: minio/minio:RELEASE.2023-12-02T10-51-33Z
    container_name: minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    ports:
      - "${MINIO_PORT}:9000"      # API端口
      - "${MINIO_CONSOLE_PORT}:9001"  # 控制台端口
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
      MINIO_REGION: ${MINIO_REGION}
    volumes:
    - ./minio/data:/data
    - ./minio/config:/root/.minio  # 添加配置目录
    networks:
      - onlyoffice-network

  # PostgreSQL 数据库
  postgres:
    image: postgres:13-alpine
    container_name: postgres
    restart: unless-stopped
    ports:
      - "${POSTGRES_EXTERNAL_PORT}:${POSTGRES_INTERNAL_PORT}"
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./postgres/data:/var/lib/postgresql/data
    networks:
      - onlyoffice-network

  # RabbitMQ 消息队列
  rabbitmq:
    image: rabbitmq:3-management-alpine
    container_name: rabbitmq
    restart: unless-stopped
    ports:
      - "${RABBITMQ_AMQP_EXTERNAL_PORT}:${RABBITMQ_AMQP_INTERNAL_PORT}"
      - "${RABBITMQ_MANAGEMENT_EXTERNAL_PORT}:${RABBITMQ_MANAGEMENT_INTERNAL_PORT}"
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_DEFAULT_USER}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_DEFAULT_PASS}
    volumes:
      - ./rabbitmq/data:/var/lib/rabbitmq
    networks:
      - onlyoffice-network

  # Redis 缓存
  redis:
    image: redis:7-alpine
    container_name: redis
    restart: unless-stopped
    ports:
      - "${REDIS_EXTERNAL_PORT}:${REDIS_INTERNAL_PORT}"
    command: redis-server --appendonly yes
    volumes:
      - ./redis/data:/data
    networks:
      - onlyoffice-network

  # OnlyOffice Document Server
  onlyoffice:
    image: onlyoffice/documentserver:latest
    container_name: onlyoffice
    restart: unless-stopped
    user: "root:root"
    ports:
      - "${ONLYOFFICE_PORT}:80"
    environment:
      JWT_ENABLED: ${ONLYOFFICE_JWT_ENABLED}
      JWT_SECRET: ${ONLYOFFICE_JWT_SECRET}
      JWT_HEADER: ${ONLYOFFICE_JWT_HEADER}
      DB_TYPE: postgres
      DB_HOST: postgres
      DB_NAME: ${POSTGRES_DB}
      DB_USER: ${POSTGRES_USER}
      DB_PWD: ${POSTGRES_PASSWORD}
      AMQP_URI: amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@rabbitmq:${RABBITMQ_AMQP_INTERNAL_PORT}
      AMQP_TYPE: rabbitmq
      REDIS_SERVER_HOST: redis
      REDIS_SERVER_PORT: ${REDIS_INTERNAL_PORT}
      # 移除S3存储配置，统一使用本地文件系统
      # 允许私有IP访问
      SERVICES_COAUTHORING_ALLOW_PRIVATE_IP_ADDRESS: "true"
      SERVICES_COAUTHORING_ALLOW_PRIVATE_HOST: "true"
      SERVICES_COAUTHORING_REQUEST_FILTERING_ALLOW_PRIVATE_IPS: "true"
      SERVICES_COAUTHORING_REQUEST_FILTERING_ALLOW_INTERNAL_URLS: "true"
      SERVICES_COAUTHORING_SERVER_REJECT_UNKNOWN_HOST: "false"
      SERVICES_COAUTHORING_CONVERTER_ALLOW_PRIVATE_IP_ADDRESS: "true"
      #   # 存储配置环境变量
      STORAGE_TYPE: fs
      FS_FOLDER_PATH: /data_hekun/onlyoffice_local_url
      CACHE_ENABLED: true
      CACHE_FLUSH_INTERVAL: PT1H
     
    volumes:
      - ./onlyoffice/data:/var/www/onlyoffice/Data
      - ./onlyoffice/logs:/var/log/onlyoffice
      - ./onlyoffice-config/local.json:/etc/onlyoffice/documentserver/local.json
      - ./data_hekun/onlyoffice_local_url:/data_hekun/onlyoffice_local_url
    networks:
      - onlyoffice-network
    depends_on:
      - postgres
      - rabbitmq
      - redis
      - minio

  # Node.js 后端服务
  node-backend:
    build: ./node
    container_name: node-backend
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      MINIO_PORT: "9000"
      MINIO_BUCKET_NAME: ${MINIO_BUCKET_NAME}
      MINIO_REGION: ${MINIO_REGION}
      MINIO_ACCESS_KEY: ${MINIO_ACCESS_KEY}
      MINIO_SECRET_KEY: ${MINIO_SECRET_KEY}
      SERVER_BASE_URL: "http://node-backend:8000"
      HOST_IP: ${HOST_IP}
    volumes:
      - ./node/temp_uploads:/app/temp_uploads
      - ./node/uploads:/app/uploads
    networks:
      - onlyoffice-network
    depends_on:
      - minio

networks:
  onlyoffice-network:
    driver: bridge

```
有的`yml`文件会多一个参数`version: '3.8'`,根据我的实践，在新版本中这个属性已经无用，可以删除，不然每次启动控制台都会报相应错误

#### 4.2.1.4 启动容器
在`docker-compose.yml`所在目录下运行以下命令启动所有容器：
```bash
docker-compose up -d
```
经常会用到的还有以下命令
```bash
# 重启容器
docker-compose restart <service-name>

# 停止容器
docker-compose down
```
**注意**：如果你也做了后端服务，比如我这里的`node-backend`，启动需要添加`--build`，因为我这里的后端服务是用`node.js`写的，需要先编译一下，将编译后的结果打包给`Docker`容器，否则修改不会同步到`Docker`容器中，示例：
```bash
docker-compose up -d --build node-backend
# 全部启动的时候直接构建
docker-compose up -d --build
```
此时，根据`docker-compose.yml`文件，会启动`postgres`、`rabbitmq`、`redis`、`minio`、`onlyoffice`、`node-backend`这六个容器，我们可以通过设置的端口号访问不同的服务，例如：
- `postgres`：`localhost:5432`
- `rabbitmq`：`localhost:5672`
- `redis`：`localhost:6379`
- `minio`：`localhost:9000`
- `onlyoffice`：`localhost:8080`
- `node-backend`：`localhost:8000`

在我的`docker-compose.yml`中，存在大量类似`${MINIO_SECRET_KEY}`的环境变量，这些变量都是从`.env`文件中读取的，例如：
```bash
MINIO_SECRET_KEY=minio-secret-key
```
我将这些配置项抽离了出来，完整的`.env`文件内容如下：
```bash
# ====================================================
# OnlyOffice + MinIO 部署环境变量配置
# ====================================================

# 项目设置
COMPOSE_PROJECT_NAME=onlyoffice-minio
# 主机IP地址
HOST_IP=localhost

# ====================================================
# MinIO 配置
# ====================================================
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=admin123
MINIO_BUCKET_NAME=onlyoffice-documents
MINIO_REGION=us-east-1
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001
# MinIO Access Keys - 基于hekun账号申请的访问密钥
MINIO_ACCESS_KEY=YEXbqjnJ64BGEQqiMKKk
MINIO_SECRET_KEY=VateaQYVo9oabIpYrC7WRj3s1vL1xz9xNYJMXxf5
# 是否更新已存在桶的策略
UPDATE_EXISTING_BUCKET_POLICY=false

# ====================================================
# PostgreSQL 配置
# ====================================================
POSTGRES_DB=onlyoffice
POSTGRES_USER=onlyoffice
POSTGRES_PASSWORD=onlyoffice_pass
POSTGRES_INTERNAL_PORT=5432
POSTGRES_EXTERNAL_PORT=15432

# ====================================================
# OnlyOffice 配置
# ====================================================
ONLYOFFICE_PORT=8080
ONLYOFFICE_JWT_ENABLED=true
ONLYOFFICE_JWT_SECRET=my_secret_key_for_onlyoffice
ONLYOFFICE_JWT_HEADER=AuthorizationJwt

# ===================== ===============================
# RabbitMQ 配置
# ====================================================
RABBITMQ_DEFAULT_USER=guest
RABBITMQ_DEFAULT_PASS=guest
RABBITMQ_AMQP_INTERNAL_PORT=5672
RABBITMQ_MANAGEMENT_INTERNAL_PORT=15672
RABBITMQ_AMQP_EXTERNAL_PORT=5672
RABBITMQ_MANAGEMENT_EXTERNAL_PORT=15672

# ====================================================
# Redis 配置
# ====================================================
REDIS_INTERNAL_PORT=6379
REDIS_EXTERNAL_PORT=63800
REDIS_PASSWORD=redis_pass
```

#### 4.2.1.5 测试连接
编写测试脚本`test-simple.ps1`验证各服务是否成功启动,脚本如下：
```bash
# 注意：请将脚本文件保存为【UTF-8 with BOM】编码，避免中文乱码
# 设置控制台编码为UTF-8，确保中文正常显示
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Write-Host "=== 服务连接测试 ===" -ForegroundColor Cyan
Write-Host "开始时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""

# 创建全局哈希表存储环境变量
$global:EnvVars = @{}

# 从.env文件读取环境变量
function Load-EnvironmentVariables($EnvFilePath) {
    if (Test-Path $EnvFilePath) {
        Write-Host "从 $EnvFilePath 加载环境变量..." -ForegroundColor Blue
        $lines = Get-Content -Path $EnvFilePath -Encoding UTF8
        
        foreach ($line in $lines) {
            # 跳过注释行和空行
            if ($line -match '^\s*#' -or $line -match '^\s*$') {
                continue
            }
            
            # 解析环境变量
            if ($line -match '^([^=]+)=(.+)$') {
                $key = $matches[1].Trim()
                $value = $matches[2].Trim()
                
                # 移除可能的引号
                if ($value -match '^["\''](.+)["\'']$') {
                    $value = $matches[1]
                }
                
                # 存储到哈希表
                $global:EnvVars[$key] = $value
                Write-Host "  已加载: $key = $value" -ForegroundColor DarkGray
            }
        }
    } else {
        Write-Host "警告: 在 $EnvFilePath 未找到.env文件，使用默认值。" -ForegroundColor Yellow
    }
}

# 加载.env文件
$envFilePath = Join-Path -Path (Get-Location).Path -ChildPath ".env"
Load-EnvironmentVariables $envFilePath

# 修复点1：定义docker-compose命令（兼容新版Docker的docker compose）
$dockerComposeCmd = if (Get-Command "docker-compose" -ErrorAction SilentlyContinue) {
    "docker-compose"
} else {
    "docker compose"
}

# 修复点2：获取docker-compose项目名称（用于匹配容器名称，默认是当前目录名）
$composeProjectName = (Get-Location).Name
# 可选：如果你的docker-compose有自定义项目名，取消下面注释并修改
# $composeProjectName = "your-custom-project-name"

# 辅助函数：根据服务名获取完整容器名
function Get-ContainerName {
    param(
        [string]$ServiceName
    )
    # 尝试匹配 项目名_服务名_1 或 服务名 格式的容器名
    $containerName = docker ps --format "{{.Names}}" | Where-Object { $_ -match "^($composeProjectName_)?$ServiceName(\d+)?$" } | Select-Object -First 1
    if (-not $containerName) {
        # 如果没找到运行中的容器，返回原始服务名（用于提示）
        return $ServiceName
    }
    return $containerName
}

# 1. 检查容器状态
Write-Host "1. 容器状态检查:" -ForegroundColor Green
try {
    Invoke-Expression "$dockerComposeCmd ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'"
} catch {
    Write-Host "  警告: 无法执行docker-compose ps，可能是当前目录没有docker-compose.yml文件或Docker未启动" -ForegroundColor Yellow
}
Write-Host ""

# 2. 测试端口连通性
Write-Host "2. 端口连通性测试:" -ForegroundColor Green

# 使用从.env读取的端口值，如果不存在则使用默认值
$onlyOfficePort = if ($global:EnvVars.ContainsKey("ONLYOFFICE_HTTP_PORT")) { $global:EnvVars["ONLYOFFICE_HTTP_PORT"] } else { 8080 }
$minioApiPort = if ($global:EnvVars.ContainsKey("MINIO_API_PORT")) { $global:EnvVars["MINIO_API_PORT"] } else { 9000 }
$minioConsolePort = if ($global:EnvVars.ContainsKey("MINIO_CONSOLE_PORT")) { $global:EnvVars["MINIO_CONSOLE_PORT"] } else { 9001 }
$postgresPort = if ($global:EnvVars.ContainsKey("POSTGRES_EXTERNAL_PORT")) { $global:EnvVars["POSTGRES_EXTERNAL_PORT"] } else { 5432 }
$rabbitmqAmqpPort = if ($global:EnvVars.ContainsKey("RABBITMQ_AMQP_EXTERNAL_PORT")) { $global:EnvVars["RABBITMQ_AMQP_EXTERNAL_PORT"] } else { 5672 }
$rabbitmqManagementPort = if ($global:EnvVars.ContainsKey("RABBITMQ_MANAGEMENT_EXTERNAL_PORT")) { $global:EnvVars["RABBITMQ_MANAGEMENT_EXTERNAL_PORT"] } else { 15672 }
$redisPort = if ($global:EnvVars.ContainsKey("REDIS_EXTERNAL_PORT")) { $global:EnvVars["REDIS_EXTERNAL_PORT"] } else { 63800 }

$ports = @(
    @{Name="OnlyOffice"; Port=$onlyOfficePort; Type="HTTP"},
    @{Name="MinIO API"; Port=$minioApiPort; Type="HTTP"},
    @{Name="MinIO Console"; Port=$minioConsolePort; Type="HTTP"},
    @{Name="PostgreSQL"; Port=$postgresPort; Type="TCP"},
    @{Name="RabbitMQ AMQP"; Port=$rabbitmqAmqpPort; Type="TCP"},
    @{Name="RabbitMQ Management"; Port=$rabbitmqManagementPort; Type="HTTP"},
    @{Name="Redis"; Port=$redisPort; Type="TCP"}
)

Write-Host "  使用环境变量或默认端口配置:" -ForegroundColor DarkGray
Write-Host "  - OnlyOffice: $onlyOfficePort" -ForegroundColor DarkGray
Write-Host "  - MinIO API: $minioApiPort" -ForegroundColor DarkGray
Write-Host "  - MinIO Console: $minioConsolePort" -ForegroundColor DarkGray
Write-Host "  - PostgreSQL: $postgresPort" -ForegroundColor DarkGray
Write-Host "  - RabbitMQ AMQP: $rabbitmqAmqpPort" -ForegroundColor DarkGray
Write-Host "  - RabbitMQ Management: $rabbitmqManagementPort" -ForegroundColor DarkGray
Write-Host "  - Redis: $redisPort" -ForegroundColor DarkGray

foreach ($item in $ports) {
    Write-Host "  $($item.Name) (端口: $($item.Port))" -NoNewline
    try {
        # 修复点3：优化Test-NetConnection的判断逻辑（兼容不同PowerShell版本）
        $result = Test-NetConnection -ComputerName localhost -Port $item.Port -WarningAction SilentlyContinue -ErrorAction Stop
        if ($result.TcpTestSucceeded -eq $true) {
            Write-Host " - 连接成功" -ForegroundColor Green
        } else {
            Write-Host " - 连接失败" -ForegroundColor Red
        }
    } catch {
        Write-Host " - 测试错误/端口未开放" -ForegroundColor Red
    }
}
Write-Host ""

# 3. 检查容器内部状态
Write-Host "3. 容器内部状态检查:" -ForegroundColor Green
$services = @(
    @{Name="postgres"; Command="psql -U onlyoffice -d onlyoffice -c 'SELECT version();'"},
    @{Name="redis"; Command="redis-cli ping"},
    @{Name="rabbitmq"; Command="rabbitmq-diagnostics ping"},
    @{Name="minio"; Command="curl -s http://localhost:9000/minio/health/live"}
)

foreach ($service in $services) {
    $containerName = Get-ContainerName -ServiceName $service.Name
    Write-Host "  $($service.Name) (容器: $containerName): " -NoNewline
    try {
        # 修复点4：移除多余的右括号，解决语法错误；统一使用sh -c包裹命令
        $result = docker exec $containerName sh -c "$($service.Command)" 2>&1
        # 修复点5：判断LASTEXITCODE（兼容容器内命令的返回值）
        if ($LASTEXITCODE -eq 0 -or $result -match "PONG|OK|PostgreSQL") {
            Write-Host "运行正常" -ForegroundColor Green
        } else {
            Write-Host "可能存在问题 (返回: $($result.ToString().Trim()))" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "无法连接/容器未运行" -ForegroundColor Red
    }
}
Write-Host ""

# 4. OnlyOffice 特殊测试
Write-Host "4. OnlyOffice 连接测试:" -ForegroundColor Green
Write-Host "  请在浏览器中手动访问: http://localhost:$onlyOfficePort" -ForegroundColor White
Write-Host "  如果无法访问，请检查以下内容:" -ForegroundColor White
Write-Host "  - OnlyOffice 容器是否运行: docker ps | findstr onlyoffice" -ForegroundColor White
Write-Host "  - OnlyOffice 日志: docker logs $(Get-ContainerName -ServiceName 'onlyoffice') --tail 20" -ForegroundColor White
Write-Host ""

# 5. MinIO 配置测试
Write-Host "5. MinIO 访问信息:" -ForegroundColor Green
Write-Host "  控制台地址: http://localhost:$minioConsolePort" -ForegroundColor White
Write-Host "  用户名: admin" -ForegroundColor White
Write-Host "  密码: admin123" -ForegroundColor White
Write-Host "  请在浏览器中手动登录并创建存储桶" -ForegroundColor White
Write-Host ""

# 6. 显示访问信息汇总
Write-Host "=== 访问信息汇总 ===" -ForegroundColor Cyan
Write-Host "1. OnlyOffice 文档服务: http://localhost:$onlyOfficePort" -ForegroundColor White
Write-Host "2. MinIO 对象存储控制台: http://localhost:$minioConsolePort" -ForegroundColor White
Write-Host "   - 用户名: admin" -ForegroundColor White
Write-Host "   - 密码: admin123" -ForegroundColor White
Write-Host "3. RabbitMQ 消息队列管理: http://localhost:$rabbitmqManagementPort" -ForegroundColor White
Write-Host "   - 用户名: guest" -ForegroundColor White
Write-Host "   - 密码: guest" -ForegroundColor White
Write-Host "4. PostgreSQL 数据库: localhost:$postgresPort" -ForegroundColor White
Write-Host "   - 数据库: onlyoffice" -ForegroundColor White
Write-Host "   - 用户: onlyoffice" -ForegroundColor White
Write-Host "   - 密码: onlyoffice_pass" -ForegroundColor White
Write-Host "5. Redis 缓存服务器: localhost:$redisPort" -ForegroundColor White
Write-Host "   - 协议: Redis" -ForegroundColor White
if ($global:EnvVars.ContainsKey('REDIS_PASSWORD')) {
    Write-Host "   - 密码: $($global:EnvVars['REDIS_PASSWORD'])" -ForegroundColor White
} else {
    Write-Host "   - 密码: redis_pass" -ForegroundColor White
}
Write-Host ""

Write-Host "结束时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Yellow
Write-Host "=== 测试脚本完成 ===" -ForegroundColor Cyan
```

运行脚本：
```bash
powershell -ExecutionPolicy Bypass -File d:\docker-data\test-simple.ps1
```
![alt text](image-7.png)

### 4.2.2 存储配置
#### 4.2.2.1 使用minio,检查minio后台是否为完整版
根据端口号访问`minio`后台，我这里是`9001`，api接口端口为`9000`。

```bash
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=admin123
```
使用预设的密码登录查看`minio`后台，用户名`admin`，密码`admin123`。

![alt text](image-8.png)

在有些版本中，虽然你能部署成功访问，但是minio为阉割版，左侧任务栏没有配置项，只能创建桶来使用，不符合我们的需求。
```yaml
  minio:
    image: minio/minio:RELEASE.2023-12-02T10-51-33Z
```
所以我们这里的minio使用的并不是最新版，而是`RELEASE.2023-12-02T10-51-33Z`版本。

minio具体配置如下：

```yaml
  minio:
    image: minio/minio:RELEASE.2023-12-02T10-51-33Z
    container_name: minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    ports:
      - "${MINIO_PORT}:9000"      # API端口
      - "${MINIO_CONSOLE_PORT}:9001"  # 控制台端口
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
      MINIO_REGION: ${MINIO_REGION}
    volumes:
    - ./minio/data:/data
    - ./minio/config:/root/.minio  # 添加配置目录
    networks:
      - onlyoffice-network
```

#### 4.2.2.1.1 创建minio对应的存储桶

在`minio`后台创建一个名为`onlyoffice-documents`的存储桶，用于存储文档服务的文件。

![alt text](image-9.png)

#### 4.2.2.1.2 为存储桶创建对应用户
我们在`.env`中添加的`admin`是`root`权限，我们需要为指定服务创建对应用户，控制权限范围。
这里我们指定了`test-user`用户，可以控制存储桶`onlyoffice-documents`。
![alt text](image-10.png)

#### 4.2.2.1.3 登录对应用户获取访问凭证
我们需要使用`test-user`用户登录`minio`后台，获取访问凭证。
![alt text](image-11.png)

这里获取到的`Access Key`和`Secret Key`就是我们在`onlyoffice`中配置的`minio`访问凭证。

```json
"storage": {
    "accessKeyId": "YEXbqjnJ64BGEQqiMKKk",
    "secretAccessKey": "VateaQYVo9oabIpYrC7WRj3s1vL1xz9xNYJMXxf5",
  
  }
```
#### 4.2.2.1.4 配置onlyoffice使用minio存储

`onlyoffice`的配置文件存在容器`/etc/onlyoffice/documentserver/local.json`中，如果不做映射，每次都得去修改，并且重启后会还原默认配置。
所以我们这里需要映射一个本地文件到容器中，用于配置`onlyoffice`使用`minio`存储。
在`Docker Compose`中，`volumes`用于将主机上的目录或文件挂载到容器中。
```yaml
  onlyoffice:
    image: onlyoffice/documentserver:7.5.0
    container_name: onlyoffice
    ports:
      - 8080:80
      volumes:
      - ./onlyoffice/data:/var/www/onlyoffice/Data
      - ./onlyoffice/logs:/var/log/onlyoffice
      - ./onlyoffice-config/local.json:/etc/onlyoffice/documentserver/local.json
      - ./data_hekun/onlyoffice_local_url:/data_hekun/onlyoffice_local_url
```

`./onlyoffice-config/local.json:/etc/onlyoffice/documentserver/local.json` 是将主机上的`./onlyoffice-config/local.json`文件挂载到容器的`/etc/onlyoffice/documentserver/local.json`中。


这里我们创建一个`local.json`文件，`storage`是关于存储的配置，内容如下：
```json
{
  "storage": {
    // 指定存储服务的类型，明确使用 MinIO（S3 兼容对象存储）作为 OnlyOffice 的文件存储后端
    "type": "minio",
    // MinIO 服务的访问端点（容器名/域名 + 端口），此处 minio 为容器名称，适用于容器化部署的内部网络通信，用于建立与 MinIO 服务的连接
    "endpoint": "http://minio:9000",
    // MinIO 中用于存放 OnlyOffice 所有文档的桶（Bucket）名称，所有业务相关文件均会存储在该指定桶内
    "bucketName": "onlyoffice-documents",
    // MinIO 服务的访问密钥 ID，用于身份认证，是访问 MinIO 服务的账号标识，配合 secretAccessKey 使用
    "accessKeyId": "YEXbqjnJ64BGEQqiMKKk",
    // MinIO 服务的秘密访问密钥，与 accessKeyId 配对使用，完成身份验证和权限校验，确保只有授权主体可操作存储资源
    "secretAccessKey": "VateaQYVo9oabIpYrC7WRj3s1vL1xz9xNYJMXxf5",
    // S3/MinIO 兼容的存储区域标识，us-east-1 是通用默认区域，无需实际物理区域部署时，保留该默认值即可正常使用
    "region": "us-east-1",
    // 该存储配置的唯一名称/标识，用于 OnlyOffice 内部区分多个存储配置（若系统配置了多存储后端时生效）
    "name": "storage-s3",
    // MinIO 桶内的嵌套存储路径，OnlyOffice 的业务文件会存放在「bucketName 桶」下的该子路径中，实现文件的分类归档管理
    "storageFolderName": "hekun-monio/files",
    // 本地缓存文件夹名称，用于缓存 MinIO 中的临时文件、常用文件，减少对 MinIO 服务的重复请求，提升文件访问效率
    "cacheFolderName": "minio-data",
    // 是否通过当前请求上下文（协议、主机、端口等）动态生成文件访问 URL，启用后可适配不同访问场景的路径需求
    "useRequestToGetUrl": true,
    // 是否使用带身份签名的 URL 访问 MinIO 中的文件，签名 URL 包含有效权限和过期信息，防止未授权访问，提升存储安全性
    "useSignedUrl": true,
    // 是否启用 SSL/TLS 加密连接 MinIO 服务，true 表示使用 HTTPS 加密通信，保障数据在传输过程中的机密性和完整性
    "sslEnabled": true,
    // 是否强制使用 S3 路径样式访问 MinIO，路径样式格式为「endpoint/bucket/object」，而非虚拟主机样式，确保兼容 MinIO 的访问规范，避免访问异常
    "s3ForcePathStyle": true
  }
}
```

**注意：**
- `endpoint`为`minio`的API地址，这里是`http://minio:9000`，端口为`9000`。而不是`minio`后台端口为`9001`。

**示例：**
`http://localhost:8080/storage-cache/hekun-monio/files/minio-data/key-1766652917365/Editor.bin/Editor.bin?md5=B6N5sbbeTG0AmsA1GvUseQ&expires=1769247511&shardkey=key-1766652917365&filename=Editor.bin`

#### 4.2.2.2 不使用minio，本地磁盘存储

#### 4.2.2.2.1 配置onlyoffice使用本地磁盘存储
关于onlyoffice配置文件`local.json`的挂载和使用`minio`的版本一样，重点是`storage`的配置不同。

```json
{
  "storage": {
    // 指定存储服务的类型，此处为 fs（File System，本地文件系统），表示 OnlyOffice 使用本地服务器磁盘作为文件存储后端
    "type": "fs",
    // 本地文件系统（fs）的专属核心配置，包含本地存储路径和对应的访问 URL 两个关键参数
    "fs": {
      // 本地服务器上的文件存储绝对路径，OnlyOffice 的所有文档会实际落地存储到该服务器本地目录中
      "folderPath": "/data_hekun/onlyoffice_local_url",
      // 该本地存储目录对应的外部可访问 HTTP URL，用于客户端（如浏览器）通过网络访问该本地目录下的文档文件,经测试，为无效属性，并不能对onlyoffice残生效果，AI的文档错误
      "url": "http://localhost:8080/data_hekun/onlyoffice_local_url"
    },
    // 本地存储根目录（folderPath）下的嵌套子路径，最终文件存储路径为「folderPath/storageFolderName」，用于对 OnlyOffice 业务文件进行分类归档管理，映射出去的虚拟目录，实际上并不会创建目录文件夹
    "storageFolderName": "hekun_local/files1_local",
    // 本地缓存文件夹名称，用于缓存 OnlyOffice 处理过程中的临时文件、常用文件，减少对核心存储目录的重复读写，提升文件访问和处理效率
    "cacheFolderName": "data_local",
    // 是否通过当前请求上下文（协议、主机、端口等信息）动态生成文件访问 URL，启用后可适配不同访问场景（如内网/外网访问）的路径需求
    "useRequestToGetUrl": true,
    // 是否使用带身份签名的 URL 访问本地存储文件，false 表示禁用签名 URL，直接通过普通 HTTP URL 访问（本地存储场景下无需签名即可管控访问权限，通常设为 false）
    "useSignedUrl": false
  }
}
```
**示例：**
`http://localhost:8080/cache/hekun_local/files1_local/data_local/key-1766653764483/Editor.bin/Editor.bin?md5=kVUTCx8G_uy99fZr_fNQLw&expires=1769248358&shardkey=key-1766653764483&filename=Editor.bin`

### 4.2.3 其他配置
1. `postgres`，`rabbitmq`，`redis`因为我们这并没有正式跑在项目上，所以虽然这些服务已经被minio调用，但是我们不需要单独做处理
2. `rabbitmq`必须配置，否则`onlyoffice` 的`websocket`服务会报错,一直弹窗

这些随着onlyoffice的服务而启动，不需要我们单独配置，继承在onlyoffice中。具体如下：

1. `onlyoffice`集成这些服务:

```yaml
 onlyoffice:
    image: onlyoffice/documentserver:latest
    container_name: onlyoffice
    restart: unless-stopped
    user: "root:root"
    ports:
      - "${ONLYOFFICE_PORT}:80"
    environment:
      JWT_ENABLED: ${ONLYOFFICE_JWT_ENABLED}
      JWT_SECRET: ${ONLYOFFICE_JWT_SECRET}
      JWT_HEADER: ${ONLYOFFICE_JWT_HEADER}
      DB_TYPE: postgres
      DB_HOST: postgres
      DB_NAME: ${POSTGRES_DB}
      DB_USER: ${POSTGRES_USER}
      DB_PWD: ${POSTGRES_PASSWORD}
      AMQP_URI: amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@rabbitmq:${RABBITMQ_AMQP_INTERNAL_PORT}
      AMQP_TYPE: rabbitmq
      REDIS_SERVER_HOST: redis
      REDIS_SERVER_PORT: ${REDIS_INTERNAL_PORT}
      # 移除S3存储配置，统一使用本地文件系统
      # 允许私有IP访问
      SERVICES_COAUTHORING_ALLOW_PRIVATE_IP_ADDRESS: "true"
      SERVICES_COAUTHORING_ALLOW_PRIVATE_HOST: "true"
      SERVICES_COAUTHORING_REQUEST_FILTERING_ALLOW_PRIVATE_IPS: "true"
      SERVICES_COAUTHORING_REQUEST_FILTERING_ALLOW_INTERNAL_URLS: "true"
      SERVICES_COAUTHORING_SERVER_REJECT_UNKNOWN_HOST: "false"
      SERVICES_COAUTHORING_CONVERTER_ALLOW_PRIVATE_IP_ADDRESS: "true"
      #   # 存储配置环境变量
      STORAGE_TYPE: fs
      FS_FOLDER_PATH: /data_hekun/onlyoffice_local_url
      CACHE_ENABLED: true
      CACHE_FLUSH_INTERVAL: PT1H
     
    volumes:
      - ./onlyoffice/data:/var/www/onlyoffice/Data
      - ./onlyoffice/logs:/var/log/onlyoffice
      - ./onlyoffice-config/local.json:/etc/onlyoffice/documentserver/local.json
      - ./data_hekun/onlyoffice_local_url:/data_hekun/onlyoffice_local_url
    networks:
      - onlyoffice-network
    depends_on:
      - postgres
      - rabbitmq
      - redis
      - minio

```

2. `redis`缓存服务配置：
```yaml
redis:
    image: redis:7-alpine
    container_name: redis
    restart: unless-stopped
    ports:
      - "${REDIS_EXTERNAL_PORT}:${REDIS_INTERNAL_PORT}"
    command: redis-server --appendonly yes
    volumes:
      - ./redis/data:/data
    networks:
      - onlyoffice-network

```
3. `rabbitmq`缓存服务配置：
```yaml
 rabbitmq:
    image: rabbitmq:3-management-alpine
    container_name: rabbitmq
    restart: unless-stopped
    ports:
      - "${RABBITMQ_AMQP_EXTERNAL_PORT}:${RABBITMQ_AMQP_INTERNAL_PORT}"
      - "${RABBITMQ_MANAGEMENT_EXTERNAL_PORT}:${RABBITMQ_MANAGEMENT_INTERNAL_PORT}"
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_DEFAULT_USER}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_DEFAULT_PASS}
    volumes:
      - ./rabbitmq/data:/var/lib/rabbitmq
    networks:
      - onlyoffice-network

```
4. `postgres`缓存服务配置：
```yaml
 postgres:
    image: postgres:13-alpine
    container_name: postgres
    restart: unless-stopped
    ports:
      - "${POSTGRES_EXTERNAL_PORT}:${POSTGRES_INTERNAL_PORT}"
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./postgres/data:/var/lib/postgresql/data
    networks:
      - onlyoffice-network

```
### 4.2.4 后端服务
 - 虽然我们已经配置完了`onlyoffice`和`minio`，并且通过各自端口号已经可以访问服务，但是`onlyoffice`还需要一个后端服务来处理文档的创建、编辑、保存等操作。

 - 我这里使用的`nodejs`作为后端服务，具体代码如下：
```javascript
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const MinIO = require("minio");
const dotenv = require("dotenv");
const httpProxy = require("http-proxy");
// 添加JWT库
const jwt = require("jsonwebtoken");
// 添加axios模块用于HTTP请求
const axios = require('axios');
const { generateOnlyOfficeToken } = require("./jwt-utils");
// 加载环境变量
dotenv.config({ path: path.join(__dirname, "../.env") });

const app = express();
const PORT = 8000;

// 从环境变量获取JWT密钥和头部配置，使用正确的环境变量名
const JWT_SECRET =
  process.env.ONLYOFFICE_JWT_SECRET || "my_secret_key_for_onlyoffice";
const JWT_HEADER = process.env.ONLYOFFICE_JWT_HEADER || "AuthorizationJwt";

// 全局请求日志中间件 - 在所有中间件之前添加
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// 设置CORS
app.use(cors());

// 解析JSON请求体
app.use(express.json());

// 确保临时上传目录存在（用于文件处理）

// 确保临时上传目录存在（用于文件处理）
const tempUploadDir = path.join(__dirname, "temp_uploads");
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

// 配置MinIO客户端 - 使用专用账号
const minioClient = new MinIO.Client({
  endPoint: process.env.MINIO_ENDPOINT || "minio", // 使用容器名，这样在Docker网络中可以直接解析
  port: parseInt(process.env.MINIO_PORT || "9000"),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY || "hekun", // 使用专用访问账号
  secretKey: process.env.MINIO_SECRET_KEY || "qqqqqqqq", // 使用专用访问密码
});

const bucketName = process.env.MINIO_BUCKET_NAME || "onlyoffice-documents";

// 配置multer使用内存存储
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// 确保MinIO桶存在
async function ensureBucketExists() {
  try {
    const exists = await minioClient.bucketExists(bucketName);
    if (!exists) {
      await minioClient.makeBucket(
        bucketName,
        process.env.MINIO_REGION || "us-east-1"
      );
      console.log(`Bucket '${bucketName}' created successfully`);

      // 只有在创建新桶时才设置桶策略
      await setBucketPolicy();
    } else {
      console.log(`Bucket '${bucketName}' already exists, skipping creation`);

      // 可选：是否对已存在的桶设置策略
      // 从环境变量读取配置，默认为false不设置
      const updateExistingPolicy =
        process.env.UPDATE_EXISTING_BUCKET_POLICY === "true";
      if (updateExistingPolicy) {
        console.log(`Updating policy for existing bucket '${bucketName}'`);
        await setBucketPolicy();
      }
    }
  } catch (error) {
    console.error("Error setting up MinIO bucket:", error);
  }
}

// 设置桶策略的辅助函数
async function setBucketPolicy() {
  try {
    await minioClient.setBucketPolicy(
      bucketName,
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${bucketName}/*`],
          },
        ],
      })
    );
    console.log(`Bucket policy for '${bucketName}' set successfully`);
  } catch (error) {
    console.error("Error setting bucket policy:", error);
  }
}

// 初始化MinIO桶
ensureBucketExists();
app.get("/health2", (req, res) => {
  res.json({ message: "POST请求成功", timestamp: new Date().getTime() });
});
// 测试POST路由
app.post("/test-post", (req, res) => {
  console.log("测试POST路由被调用");
  res.json({ message: "POST请求成功", timestamp: new Date().getTime() });
});

// 测试GET路由
app.get("/test-get", (req, res) => {
  console.log("测试GET路由被调用");
  res.json({ message: "GET请求成功", timestamp: new Date().getTime() });
});


// 文件上传接口 - 使用MinIO -集成token返回，config配置
/**
 * 生成 MinIO 预签名 GET URL
 * @param {string} bucketName - MinIO 桶名
 * @param {string} objectName - MinIO 中的对象名（如 onlyoffice-documents/1766543027603-）
 * @param {number} expires - URL 过期时间（单位：秒，示例为 7 天 = 604800 秒）
 * @returns {Promise<string>} 带签名的预签名 URL
 */
async function generatePresignedUrl(bucketName, objectName, expires = 604800) {
  try {
    // SDK 自动生成包含 X-Amz-* 签名参数的 URL
    const presignedUrl = await minioClient.presignedGetObject(bucketName, objectName, expires);
    console.log('生成的预签名 URL：', presignedUrl);
    return presignedUrl;
  } catch (err) {
    console.error('生成预签名 URL 失败：', err);
    throw err;
  }
}
app.post("/upload2", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    // 确保中文文件名正确处理，使用更安全的方式处理文件名，避免MinIO不支持的字符
    const timestamp = Date.now();
    // 使用正则表达式移除或替换MinIO不支持的特殊字符
    const safeOriginalName = req.file.originalname.replace(/[^a-zA-Z0-9._-\u4e00-\u9fa5]/g, '_');
    // const filename = timestamp + "-" + safeOriginalName;
    const filename = timestamp + "-";
    const fileStream = new Buffer(req.file.buffer, "binary");
    //从原始文件名中提取扩展名，而不是从mimetype中获取
    const originalFilename = req.file.originalname;
    const sign = await generatePresignedUrl(bucketName, filename);

    const extension = path.extname(originalFilename).toLowerCase().slice(1); // 获取扩展名并去除点号
    let documentType = extension;
    
    console.log(`原始文件名: ${originalFilename}, 提取的扩展名: ${extension}`);
    
    // 映射扩展名到OnlyOffice支持的documentType
    if (documentType === "docx" || documentType === "doc") {
      documentType = "word";
    } else if (documentType === "xlsx" || documentType === "xls") {
      documentType = "cell";
    } else if (documentType === "pptx" || documentType === "ppt") {
      documentType = "slide";
    } else if (documentType === "pdf") {
      documentType = "pdf";
    } else {
      documentType = "word";  // 默认设为word类型
    }
    // 上传文件到MinIO
    await minioClient.putObject(
      bucketName,
      filename,
      fileStream,
      req.file.size,
      { "Content-Type": req.file.mimetype }
    );

    // 生成可访问的文件URL
    const fileUrl = `/files/${filename}`;

    // 获取服务的基础URL，优先使用环境变量或动态配置
    const hostIp = process.env.HOST_IP || "localhost";
    const baseUrl = process.env.SERVER_BASE_URL || `http://${hostIp}:${PORT}`;
    let config = {
      document: {
        fileType: extension,
        key: `key-${timestamp}`,
        title: req.file.originalname,  // 使用原始文件名作为显示标题
        // url: `${sign}`,
        url: `${baseUrl}/downloadfile/key-${timestamp}`,
        // 明确指定下载URL为Node.js服务器的/downloadfile接口
        // downloadUrl: `${baseUrl}/downloadfile/key-${timestamp}`,
        // 【关键3】指定存储类型为自定义，告诉OnlyOffice不要用自身存储
        storageType: "Custom",
        // 【关键4】添加文件的最后修改时间（防止OnlyOffice缓存旧地址）
        modified: timestamp,
        key: `key-${timestamp}`,
      },
      documentType: documentType,

      editorConfig: {
        // 设置callbackURL以便OnlyOffice可以保存文档到Node.js服务器
        callbackUrl: `${baseUrl}/callback`,
        user: {
          id: "user-1",
          name: "用户",
        },
        mode: "edit",
        lang: "zh-CN",
        // 添加服务配置确保使用正确的URL
        services: {
          UrlConverter: {
            url: "",
            convCallbackUrl: "",
          },
        },
        // 【关键6】允许编辑器直接下载/访问外部文件
        permissions: {
          download: true,
          edit: true,
          access: true,
        },
       
      },
      // 【关键8】添加token，用于OnlyOffice安全验证
      // 注意：根据OnlyOffice文档，当启用token验证时，这里需要包含token参数
      height: "600px",
      width: "100%",
      // 【关键9】禁用OnlyOffice的自动代理（新增）
      disableBrowserCache: true,
    };
    config.token = generateOnlyOfficeToken(config);
    res.json({
      filename: filename,
      url: fileUrl,
      size: req.file.size,
      type: req.file.mimetype,
      // 生成OnlyOffice兼容的文档键，使用与filename相同的时间戳
      documentKey: `key-${timestamp}`,
      // 添加OnlyOffice兼容的完整下载URL，使用与filename相同的时间戳
      downloadUrl: `${baseUrl}/downloadfile/key-${timestamp}`,
      test: "test1111",
      // jwtToken: generateOnlyOfficeToken(document),
      config: config,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

// 文件下载功能 - 从MinIO
app.get("/files/:filename", async (req, res) => {
  const filename = req.params.filename;

  try {
    // 检查文件是否存在
    const stat = await minioClient.statObject(bucketName, filename);

    // 设置响应头，解码文件名以显示正确的中文文件名
    const decodedFilename = decodeURIComponent(filename);
    res.setHeader(
      "Content-Type",
      stat.metaData["content-type"] || "application/octet-stream"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${decodedFilename}"`
    );
    res.setHeader("Content-Length", stat.size);

    // 从MinIO获取文件流
    const fileStream = await minioClient.getObject(bucketName, filename);
    fileStream.pipe(res);

    fileStream.on("error", (err) => {
      console.error("File stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to stream file" });
      }
    });
  } catch (error) {
    if (error.code === "NoSuchKey") {
      res.status(404).json({ error: "File not found" });
    } else {
      console.error("Download error:", error);
      res
        .status(500)
        .json({ error: "Internal server error: " + error.message });
    }
  }
});

// 使用app.route同时注册GET和POST路由
app
  .route("/downloadfile/key-:timestamp")
  .get(async (req, res) => {
    const timestamp = req.params.timestamp;
    console.log(`收到GET请求，时间戳: ${timestamp}`);
    await downloadFileByTimestamp(timestamp, req, res);
  })
  .post(async (req, res) => {
    const timestamp = req.params.timestamp;
    console.log(`收到POST请求，时间戳: ${timestamp}`);
    await downloadFileByTimestamp(timestamp, req, res);
  });

// 新增测试POST路由
app.post("/test-post", (req, res) => {
  console.log("测试POST路由被调用");
  res.json({ message: "POST请求成功", timestamp: new Date().getTime() });
});

// 共享的下载逻辑函数（保留但暂时不使用）
async function downloadFileByTimestamp(timestamp, req, res) {
  try {
    // 列出MinIO桶中的所有对象
    const objectsStream = minioClient.listObjectsV2(bucketName, "", true);

    // 查找匹配的文件
    let matchingFile = null;
    for await (const obj of objectsStream) {
      if (obj.name.includes(timestamp)) {
        matchingFile = obj.name;
        console.log(`找到匹配的文件: ${matchingFile}`);
        break;
      }
    }

    if (matchingFile) {
      // 获取文件统计信息
      const stat = await minioClient.statObject(bucketName, matchingFile);

      // 设置响应头
      const decodedFilename = decodeURIComponent(matchingFile);
      res.setHeader(
        "Content-Type",
        stat.metaData["content-type"] || "application/octet-stream"
      );
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${decodedFilename}"`
      );
      res.setHeader("Content-Length", stat.size);

      // 从MinIO获取文件流
      const fileStream = await minioClient.getObject(bucketName, matchingFile);
      fileStream.pipe(res);

      fileStream.on("error", (err) => {
        console.error("File stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream file" });
        }
      });
    } else {
      console.log(`未找到时间戳为 ${timestamp} 的文件`);

      // 提供所有文件列表以便调试
      const allFiles = [];
      const stream = minioClient.listObjectsV2(bucketName, "", true);
      for await (const obj of stream) {
        allFiles.push(obj.name);
      }

      res.status(404).json({
        error: "File not found for the specified key",
        timestamp: timestamp,
        availableFiles: allFiles,
      });
    }
  } catch (error) {
    console.error("Error searching for file:", error);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
}

// 添加获取文件MIME类型的辅助函数
function getContentTypeByExtension(extension) {
  const contentTypeMap = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif'
  };
  
  // 如果扩展名不以点开头，添加点
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
  
  // 返回对应的MIME类型，如果没有找到则返回默认值
  return contentTypeMap[normalizedExtension.toLowerCase()] || 'application/octet-stream';
}

// 确保回调处理中也使用正确的URL处理
// OnlyOffice回调接口 - 使用MinIO保存文档
app.post("/callback", async (req, res) => {
  try {
    const body = req.body;

    // 记录回调数据
    console.log("OnlyOffice回调数据:", JSON.stringify(body, null, 2));

    // 检查状态
    if (body.status === 2) {
      // 状态2表示文档已准备好保存
      console.log("文档准备好保存:", body.key);

      // 从key中提取时间戳并找到对应的文件
      const timestamp = body.key.split("-").pop();
      const objectsStream = minioClient.listObjectsV2(bucketName, "", true);

      let matchingFile = null;
      for await (const obj of objectsStream) {
        if (obj.name.includes(timestamp)) {
          matchingFile = obj.name;
          break;
        }
      }

      // 如果需要，可以在这里实现文档内容的保存逻辑
      // 例如从OnlyOffice服务器获取更新后的文档内容并上传到MinIO
      if (matchingFile) {
        console.log(`找到对应的文件: ${matchingFile}`);

        // 如果有新的文档URL，可以下载并更新文件
        if (body.url) {
          console.log(`文档有更新，新URL: ${body.url}`);
          
          try {
            // 下载更新后的文档内容
            const response = await axios.get(body.url, {
              responseType: 'arraybuffer',
              headers: {
                'Content-Type': 'application/octet-stream'
              }
            });
            
            // 获取文档数据作为Buffer
            const buffer = Buffer.from(response.data, 'binary');
            
            console.log(`成功下载更新文档，大小: ${buffer.length} 字节`);
            
            // 从原文件名中提取信息
            const originalExtension = path.extname(matchingFile).toLowerCase();
            
            // 保存回MinIO，覆盖原文件
            await minioClient.putObject(
              bucketName,
              matchingFile,  // 使用相同的文件名，覆盖原文件
              buffer,
              buffer.length,
              { "Content-Type": getContentTypeByExtension(originalExtension) }
            );
            
            console.log(`成功将更新后的文档保存到MinIO: ${matchingFile}`);
            
            // 可选：创建一个新版本的文件，保留历史版本
            // const newVersionFile = matchingFile.replace(originalExtension, `-updated${Date.now()}${originalExtension}`);
            // await minioClient.putObject(bucketName, newVersionFile, buffer, buffer.length);
            // console.log(`创建了新版本文件: ${newVersionFile}`);
            
          } catch (downloadError) {
            console.error("下载并保存更新文档时出错:", downloadError);
            // 记录错误但不影响OnlyOffice的回调响应
          }
        }
      }
    }

    // 返回成功响应
    res.status(200).json({ error: 0 });
  } catch (error) {
    console.error("Callback error:", error);
    res.status(500).json({ error: 1 });
  }
});

// 添加一个文件列表接口，方便调试
app.get("/filelist", async (req, res) => {
  try {
    const files = [];
    const objectsStream = minioClient.listObjectsV2(bucketName, "", true);

    for await (const obj of objectsStream) {
      files.push({
        name: obj.name,
        size: obj.size,
        lastModified: obj.lastModified,
      });
    }

    res.json({
      bucket: bucketName,
      fileCount: files.length,
      files: files,
    });
  } catch (error) {
    console.error("Error listing files:", error);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

// 健康检查接口
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "Node.js File Server",
    port: PORT,
    minioBucket: bucketName,
    test: "打包成功",
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`
========================================
Node.js 文件服务器已启动！
地址: http://localhost:${PORT}

可用端点:
- 测试GET路由:  GET  http://localhost:${PORT}/test-get
- 测试POST路由: POST http://localhost:${PORT}/test-post
- 文件上传:     POST http://localhost:${PORT}/upload2
- 文件下载:     GET  http://localhost:${PORT}/files/{filename}
- OnlyOffice下载: GET http://localhost:${PORT}/downloadfile/key-{timestamp}
- 回调接口:     POST http://localhost:${PORT}/callback
- 文件列表:     GET  http://localhost:${PORT}/filelist
- 健康检查:     GET  http://localhost:${PORT}/health
========================================
`);
});
```

1. `onlyoffice` 调用`downloadfile`接口实际上走的是`POST`请求，而不是`GET`请求。在测试后给`downloadfile`方法配置了`POST`。
2. 在`nodejs`中，我们也需要配置`node`和`minio`的连接，和`onlyoffice`一样，使用`accessKey`和`secretKey`

```javascript
// 配置MinIO客户端 - 使用专用账号
const minioClient = new MinIO.Client({
  endPoint: process.env.MINIO_ENDPOINT || "minio", // 使用容器名，这样在Docker网络中可以直接解析
  port: parseInt(process.env.MINIO_PORT || "9000"),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY || "hekun", // 使用专用访问账号
  secretKey: process.env.MINIO_SECRET_KEY || "qqqqqqqq", // 使用专用访问密码
});
```
3. 因为`onlyoffice`使用`JWT`认证，所以在`nodejs`中也需要配置`JWT`认证。需要生成`JWT`签名给前端，前端初始化`onlyoffice`编辑器的时候要传递给`onlyoffice`。具体的签名实现，我放在了`jwt-utils.js`文件中。`ONLYOFFICE_JWT_SECRET`是`onlyoffice`的`JWT`密钥，和`docker-compose.yml`中配置的一致。
```javascript
const jwt = require('jsonwebtoken');

// 你的OnlyOffice JWT密钥（和Docker配置中的一致）
const ONLYOFFICE_JWT_SECRET = 'my_secret_key_for_onlyoffice';

/**
 * 生成OnlyOffice的JWT令牌
 * @param {object} payload 载荷（可包含用户、文档信息等，非必需）
 * @returns {string} JWT令牌
 */
function generateOnlyOfficeToken(payload = {}) {
  // 可以设置过期时间，比如1小时（避免令牌长期有效）
  return jwt.sign(payload, ONLYOFFICE_JWT_SECRET, { expiresIn: '1h' });
}
/**
 * 验证OnlyOffice的JWT令牌
 * @param {string} token JWT令牌
 * @returns {object} 解码后的载荷（验证失败则抛出错误）
 */
function verifyOnlyOfficeToken(token) {
  try {
    return jwt.verify(token, ONLYOFFICE_JWT_SECRET);
  } catch (error) {
    throw new Error('JWT验证失败：' + error.message);
  }
}
module.exports = {
  generateOnlyOfficeToken,
  verifyOnlyOfficeToken
};
```

4. `payload` 是一个对象，用于包含文档相关的信息，比如文档ID、文档类型、文档标题等。这些信息会被`onlyoffice`用于文档的展示和管理。这个其实就是前端哪来初始化`onlyoffice`编辑器的的`config`参数。**这里有一个隐藏的坑，就是`JWT`的生成需要完整的参数，所以前端初始化`onlyoffice`编辑器的时候，整个参数应该是后端生成后传递给前端的，而不是前端在`js`中自行编写，否者会出现`JWT`令牌校验不通过**。
5. 关于`JWT`还有一个隐藏的坑，就是如果你不使用`JWT`，`onlyoffice`禁止本地ip访问的，会直接导致`downloadfile`流程失败，无法初始化编辑器展示对应文件。这也是查阅大量资料和实测后发现。

### 4.2.5 前端服务
- 后端服务配置完成后，上传的内容会被存储在`minio`对应的桶中，比如PPT/word/pdf等。
- `onlyoffice`配置完成后，`onlyoffice`载入对应文件产生的临时文件，比如`Edit.bin`等会被存储到`minio`对应位置。

此时，我们需要一个前端服务来给我们展示`onlyoffice`编辑器，测试文件上传功能。因此我们需要编写一个html文件。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OnlyOffice 文档编辑</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-bottom: 30px;
        }
        .upload-section {
            margin-bottom: 30px;
            padding: 20px;
            background-color: #f9f9f9;
            border-radius: 5px;
        }
        #fileInput {
            padding: 10px;
            margin-bottom: 10px;
        }
        button {
            background-color: #4CAF50;
            color: white;
            border: none;
            padding: 10px 20px;
            text-align: center;
            text-decoration: none;
            display: inline-block;
            font-size: 16px;
            margin: 4px 2px;
            cursor: pointer;
            border-radius: 4px;
        }
        button:hover {
            background-color: #45a049;
        }
        #editor {
            width: 100%;
            height: 600px;
            border: 1px solid #ccc;
        }
        .status {
            margin-top: 10px;
            padding: 10px;
            background-color: #e8f5e9;
            border-radius: 4px;
            display: none;
        }
        .error {
            background-color: #ffebee;
            color: #c62828;
        }
    </style>
    <!-- 动态加载OnlyOffice API -->
    <script type="text/javascript">
      // 配置主机IP地址 - 这里可以从URL参数或其他方式获取
      // 注意：HTML文件无法直接读取.env文件，这里使用硬编码作为默认值
      // 在实际部署中，可以通过服务器端渲染或构建时替换这个值
      const HOST_IP = 'localhost'; // 从.env文件中的HOST_IP获取
      
      // 动态创建并加载OnlyOffice API脚本
      const apiScript = document.createElement('script');
      apiScript.type = 'text/javascript';
      apiScript.src = `http://${HOST_IP}:8080/web-apps/apps/api/documents/api.js`;
      document.head.appendChild(apiScript);
      
      // 全局配置对象，供其他脚本使用
      window.onlyOfficeConfig = {
        hostIp: HOST_IP,
        onlyOfficePort: '8080',
        nodeServerPort: '8000',
        htmlServerPort: '8081'
      };
    </script>
</head>
<body>
    <div class="container">
        <h1>OnlyOffice 文档编辑</h1>
        
        <div class="upload-section">
            <h2>上传文档</h2>
            <input type="file" id="fileInput" accept=".docx,.doc,.xlsx,.xls,.pptx,.ppt,.pdf">
            <button id="uploadBtn">上传并编辑</button>
            <div id="status" class="status"></div>
        </div>
        
        <div id="editorSection" style="display: none;">
            <h2>文档编辑</h2>
            <div id="editor"></div>
        </div>
    </div>

    <script>
        // 配置
        const config = {
            documentServerUrl: `http://${window.onlyOfficeConfig.hostIp}:${window.onlyOfficeConfig.onlyOfficePort}/`,
            documentType: '',
            documentUrl: '',
            documentKey: '',
            fileInput: null,
            uploadUrl: `http://${window.onlyOfficeConfig.hostIp}:${window.onlyOfficeConfig.nodeServerPort}/upload`, // Node.js上传接口
            editor: null
        };

        // 初始化
        function init() {
            config.fileInput = document.getElementById('fileInput');
            document.getElementById('uploadBtn').addEventListener('click', handleUpload);
        }

        // 处理文件上传
        function handleUpload() {
            const file = config.fileInput.files[0];
            if (!file) {
                showStatus('请选择一个文件', true);
                return;
            }

            showStatus('正在上传文件...');
            
            // 创建FormData对象
            const formData = new FormData();
            formData.append('file', file);
            
            // 发送到我们的文件服务器，使用统一的IP地址
            fetch(`http://${window.onlyOfficeConfig.hostIp}:${window.onlyOfficeConfig.nodeServerPort}/upload2`, {
                method: 'POST',
                body: formData
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('上传失败: ' + response.status);
                }
                return response.json();
            })
            .then(data => {
                console.log('数据响应:', data);
                console.log('配置信息:', config);
                // 显示编辑器
                showStatus('文件上传成功，正在加载编辑器...');
                showEditor(data.config);
            })
            .catch(error => {
                showStatus('上传文件时出错: ' + error.message, true);
                console.error('上传错误:', error);
            });
        }

        // 根据文件扩展名获取文档类型
        function getDocumentType(extension) {
            const typeMap = {
                'docx': 'word',
                'doc': 'word',
                'xlsx': 'cell',
                'xls': 'cell',
                'pptx': 'presentation',
                'ppt': 'presentation',
                'pdf': 'pdf'
            };
            return typeMap[extension] || null;
        }

        // 显示编辑器
    async   function showEditor(editorConfig) {
        console.log('编辑器配置:', editorConfig);
            document.getElementById('editorSection').style.display = 'block';
            
            // 生成OnlyOffice所需的JWT令牌参数
            // 注意：此处我们不需要在前端生成完整JWT令牌，因为OnlyOffice需要在其配置中看到token参数
            // 后端会在请求时生成并提供正确的令牌
           
            config.editor = new DocsAPI.DocEditor("editor", editorConfig);
            showStatus('编辑器加载完成，可以开始编辑文档');
        }




        // 显示状态信息
        function showStatus(message, isError = false) {
            const statusElement = document.getElementById('status');
            statusElement.textContent = message;
            statusElement.style.display = 'block';
            
            if (isError) {
                statusElement.classList.add('error');
            } else {
                statusElement.classList.remove('error');
            }
        }

        // 页面加载完成后初始化
        window.onload = init;
    </script>
</body>
</html>




```

这里有一些残余代码是我测试前端生成`JWT`令牌时留下的，实际令牌应该由后端服务生成，前端拿到整体返回的`config`通过`showEditor(editorConfig)`初始化编辑器即可。

最后我们还需要访问html文件来测试，通过python启动服务，在浏览器中打开`http://localhost:8081/`即可。
```
python -m http.server 8081
```

这时候我们就可以开始对`onlyoffice`的实际体验了。

# 5. 部署过程中遇到的问题

### 5.1 问题描述
1. `nodejs`服务部署在8000端口，`http://localhost:8000/downloadfile/key-{timestamp}`下载接口经过`onlyoffice`处理后，端口号变成了`onlyoffice`的8080端口，导致下载失败。
2. `JWT`令牌不匹配，因为最初前端`config`是在`html`中定义的，而不是后端生成集体返回的，`JWT`的生成，除了需要秘钥，还需要`config`里每一项配置都一样，包括`fileType`、`documentType`、`document`等。
3. `onlyoffice`的`local.json`配置，网上资料以及ai提示存在大量错误信息，每一个属性都需要反复测试

### 5.2 解决方法
### 5.2.1 nodejs服务部署在8000端口，端口号变成了onlyoffice的8080端口，导致下载失败

通过日志查看，实际是onlyoffice访问接口被拒绝，拒绝原因就是我们之前提过的，在不开启JWT的情况下，onlyoffice会拒绝私有ip访问。
```log
[2025-12-17T01:55:16.229] [ERROR] [localhost] [key-1765936513874] [user-1] nodeJS - error downloadFile:url=http://localhost:8000/files/1765936513859-åç«¯å¼åå·¥ç¨å¸-ä½å¤.pdf;attempt=3;code:undefined;connect:undefined Error: DNS lookup 127.0.0.1(family:4, host:localhost) is not allowed. Because, It is private IP address.
    at Function.from (/snapshot/server/Common/node_modules/axios/dist/node/axios.cjs)
    at RedirectableRequest.handleRequestError (/snapshot/server/Common/node_modules/axios/dist/node/axios.cjs)
    at RedirectableRequest.emit (node:events:536:35)
    at ClientRequest.<anonymous> (/snapshot/server/Common/node_modules/follow-redirects/index.js:49:24)
    at ClientRequest.emit (node:events:524:28)
    at emitErrorEvent (node:_http_client:101:11)
    at Socket.socketErrorListener (node:_http_client:504:5)
    at Socket.emit (node:events:524:28)
    at emitErrorNT (node:internal/streams/destroy:169:8)
    at emitErrorCloseNT (node:internal/streams/destroy:128:3)
    at Axios.request (/snapshot/server/Common/node_modules/axios/dist/node/axios.cjs)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async Object.downloadUrlPromise (/snapshot/server/Common/sources/utils.js)
```
### 5.2.2 JWT令牌不匹配
通过不断测试，最后统一由后端生成编辑器初始化的`config`，成功解决问题
```log
[2025-12-22T09:27:57.857] [ERROR] [localhost] [docId] [userId] nodeJS - [AMQP] Error: Handshake terminated by server: 403 (ACCESS-REFUSED) with message "ACCESS_REFUSED - Login was refused using authentication mechanism PLAIN. For details see the broker logfile."
    at afterStartOk (/snapshot/server/Common/node_modules/amqplib/lib/connection.js:169:16)
    at /snapshot/server/Common/node_modules/amqplib/lib/connection.js:104:11
    at Socket.recv (/snapshot/server/Common/node_modules/amqplib/lib/connection.js:453:9)
    at Object.onceWrapper (node:events:638:28)
    at Socket.emit (node:events:524:28)
    at emitReadable_ (node:internal/streams/readable:834:12)
    at process.processTicksAndRejections (node:internal/process/task_queues:81:21)

```

### 5.2.2 `onlyoffice`的`local.json`配置

只有文件存储本地时，storage.fs才会生效，包含配置对本地文件存储进行处理。

