-- WaveDrop → Apple Music bridge helper
-- Usage:
--   osascript add-to-music.applescript "<name>" "<posixFile>" "<persistentID>" "<expectedTrackName>"
--   - persistentID (optional) targets an EXACT playlist even when several share
--     a name. If given and found, it wins. Else fall back to the name (create if missing).
--   - expectedTrackName (optional) lets us check the LIBRARY first and REUSE an
--     existing track instead of re-importing it → no duplicate library entries
--     when the same song is downloaded again.
--   - posixFile "" → only resolve/ensure the playlist (no import).
--
-- Prints one line the Node bridge parses:
--   ok:added | ok:duplicate | ok:exists :: <name> :: <count> | err:<message>

on run argv
	set playlistName to "Juice WRLD Unreleased"
	set filePath to ""
	set playlistPID to ""
	set expectedName to ""

	if (count of argv) ≥ 1 then set playlistName to item 1 of argv
	if (count of argv) ≥ 2 then set filePath to item 2 of argv
	if (count of argv) ≥ 3 then set playlistPID to item 3 of argv
	if (count of argv) ≥ 4 then set expectedName to item 4 of argv

	tell application "Music"
		if not running then launch

		-- Generous Apple-Events timeout: when Music is busy (importing/indexing)
		-- the default ~60s can expire AFTER the add already happened, which the
		-- caller would misread as a failure. 300s avoids that race.
		with timeout of 300 seconds

			-- 1) Resolve the target playlist — persistent ID first (unambiguous).
			set thePlaylist to missing value
			if playlistPID is not "" then
				try
					set thePlaylist to (first user playlist whose persistent ID is playlistPID)
				end try
			end if

			-- 2) Fall back to name (create if missing).
			if thePlaylist is missing value then
				if not (exists (some user playlist whose name is playlistName)) then
					make new user playlist with properties {name:playlistName}
				end if
				set thePlaylist to (first user playlist whose name is playlistName)
			end if

			-- No file → just report which playlist we resolved (for verification).
			if filePath is "" then
				return "ok:exists :: " & (name of thePlaylist) & " :: " & (count of tracks of thePlaylist)
			end if

			-- 3) Reuse an existing library track if we already have this song;
			--    otherwise import the file. `add` may return a list.
			set theTrack to missing value
			if expectedName is not "" then
				try
					set libMatches to (every track of library playlist 1 whose name is expectedName)
					if (count of libMatches) > 0 then set theTrack to item 1 of libMatches
				end try
			end if
			if theTrack is missing value then
				set theTrack to (add (POSIX file filePath))
				if (class of theTrack) is list then set theTrack to item 1 of theTrack
			end if
			set trackName to (get name of theTrack)

			-- 4) Dedupe within THIS playlist.
			if (count of (every track of thePlaylist whose name is trackName)) > 0 then
				return "ok:duplicate"
			end if

			duplicate theTrack to thePlaylist
			return "ok:added"

		end timeout
	end tell
end run
