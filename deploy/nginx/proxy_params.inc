# Header standar ke API. Nilai ini DIBUAT Nginx (tepercaya) — API dengan TRUST_PROXY=true
# memakainya untuk request.ip. Header X-Forwarded-For dari klien ditimpa, bukan diteruskan.
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Upgrade           $http_upgrade;
proxy_set_header Connection        $connection_upgrade;
