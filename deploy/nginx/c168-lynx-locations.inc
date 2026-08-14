# Lynx web host — include inside count168.site server { }
location = /c168_lynx {
    return 302 /c168_lynx/web/;
}

location = /c168_lynx/ {
    return 302 /c168_lynx/web/;
}

location ^~ /c168_lynx/web/ {
    types {
        application/wasm wasm;
        application/javascript js;
        text/css css;
        text/html html;
        application/octet-stream bundle;
    }
    add_header Cache-Control "no-cache";
    try_files $uri $uri/ /c168_lynx/web/index.html;
}
