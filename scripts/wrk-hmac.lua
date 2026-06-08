-- wrk + HMAC per request (BENCH_API_KEY, BENCH_SECRET_KEY, BENCH_HMAC_PATH)
local api_key = os.getenv("BENCH_API_KEY") or ""
local secret = os.getenv("BENCH_SECRET_KEY") or ""
local base_path = os.getenv("BENCH_HMAC_PATH") or "/v1/api/get"
local method = "GET"
local counter = 0

function sign(ts, req_path)
  local payload = api_key .. "\n" .. ts .. "\n" .. method .. "\n" .. req_path .. "\n"
  local tmp = os.tmpname()
  local f = io.open(tmp, "w")
  f:write(payload)
  f:close()
  local cmd = string.format(
    "openssl dgst -sha256 -hmac %q %q 2>/dev/null | awk '{print $2}'",
    secret,
    tmp
  )
  local h = io.popen(cmd)
  local sig = h:read("*l") or ""
  h:close()
  os.remove(tmp)
  return sig
end

request = function()
  counter = counter + 1
  local ts = tostring(os.time())
  local req_path = base_path .. "?bench=" .. counter
  local sig = sign(ts, req_path)
  local headers = {}
  headers["X-API-Key"] = api_key
  headers["X-Timestamp"] = ts
  headers["X-Signature"] = sig
  return wrk.format(method, req_path, headers)
end
