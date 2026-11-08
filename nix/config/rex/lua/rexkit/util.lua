-- Small helpers shared by restore and the sessioniser.
local M = {}

local home = os.getenv("HOME") or ""

M.home = home
M.config_dir = (os.getenv("XDG_CONFIG_HOME") or (home .. "/.config")) .. "/rex"
M.state_dir = (os.getenv("XDG_STATE_HOME") or (home .. "/.local/state")) .. "/rex"

-- rex.call that raises on failure (rex.call returns nil and a message), and
-- attaches to a session the first time a call needs it.
function M.call(method, args)
	local res, err = rex.call(method, args)
	if res == nil and err and args and args.session_id and tostring(err):find("not attached", 1, true) then
		local ok, aerr = rex.call("session.attach", { session_id = args.session_id })
		if ok == nil then error(method .. ": " .. tostring(aerr), 2) end
		res, err = rex.call(method, args)
	end
	if res == nil and err then error(method .. ": " .. tostring(err), 2) end
	return res
end

function M.expand(path)
	if not path then return nil end
	if path == "~" then return home end
	if path:sub(1, 2) == "~/" then return home .. path:sub(2) end
	return path
end

function M.join(dir, rel)
	if not rel or rel == "" then return dir end
	rel = M.expand(rel)
	if rel:sub(1, 1) == "/" then return rel end
	return (dir:gsub("/$", "")) .. "/" .. rel
end

function M.basename(path)
	return (path:gsub("/$", ""):match("([^/]+)$")) or path
end

function M.parent(path)
	return path:gsub("/$", ""):match("^(.*)/[^/]+$") or "/"
end

-- Single-quote for sh and fish alike.
function M.quote(s)
	return "'" .. tostring(s):gsub("'", "'\\''") .. "'"
end

function M.mkdir(dir)
	rex.exec({ "mkdir", "-p", dir })
end

function M.read_file(path)
	local f = io.open(path, "r")
	if not f then return nil end
	local s = f:read("*a")
	f:close()
	return s
end

-- Written beside the target and renamed over it, so readers never see half a file.
function M.write_file(path, data)
	M.mkdir(M.parent(path))
	local tmp = path .. ".tmp"
	local f = assert(io.open(tmp, "w"))
	f:write(data)
	f:close()
	assert(os.rename(tmp, path))
end

function M.read_json(path)
	local s = M.read_file(path)
	if not s or s == "" then return nil end
	local ok, v = pcall(rex.json.decode, s)
	return ok and v or nil
end

function M.write_json(path, value)
	M.write_file(path, rex.json.encode(value))
end

-- A glob ("sudo *", "nvim*") as an anchored Lua pattern.
function M.glob(pattern)
	local p = pattern:gsub("[%^%$%(%)%%%.%[%]%+%-]", "%%%0"):gsub("%*", ".*"):gsub("%?", ".")
	return "^" .. p .. "$"
end

function M.matches_any(s, globs)
	for _, g in ipairs(globs or {}) do
		if s:match(M.glob(g)) then return true end
	end
	return false
end

-- Loads a Lua config file that returns a table; nil and a message on failure.
function M.load_config(path)
	local chunk, err = loadfile(path)
	if not chunk then return nil, err end
	local ok, value = pcall(chunk)
	if not ok then return nil, value end
	return value
end

-- Directory entries that are directories, sorted, hidden ones skipped.
function M.subdirs(dir)
	local out = {}
	local r = rex.exec({ "find", dir, "-mindepth", "1", "-maxdepth", "1", "-type", "d", "-not", "-name", ".*" })
	for line in ((r and r.stdout) or ""):gmatch("[^\n]+") do table.insert(out, line) end
	table.sort(out)
	return out
end

function M.is_dir(path)
	local r = rex.exec({ "test", "-d", path })
	return r ~= nil and r.ok == true
end

return M
