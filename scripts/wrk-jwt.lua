-- wrk + Bearer JWT per request (BENCH_ACCESS_TOKEN, BENCH_JWT_PATH)
local token = os.getenv("BENCH_ACCESS_TOKEN") or ""
local base_path = os.getenv("BENCH_JWT_PATH") or "/v1/api/get"
local method = "GET"
local counter = 0

request = function()
  counter = counter + 1
  local req_path = base_path .. "?bench=" .. counter
  local headers = {}
  headers["Authorization"] = "Bearer " .. token
  return wrk.format(method, req_path, headers)
end
