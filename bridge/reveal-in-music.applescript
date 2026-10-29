-- WaveDrop → reveal a playlist in Apple Music and bring the app to front.
-- Usage: osascript reveal-in-music.applescript "<name>" "<persistentID>"
--   persistentID (optional) targets an exact playlist when names collide.
-- Prints: ok:revealed | err:not_found

on run argv
	set playlistName to "Juice WRLD Unreleased"
	set playlistPID to ""
	if (count of argv) ≥ 1 then set playlistName to item 1 of argv
	if (count of argv) ≥ 2 then set playlistPID to item 2 of argv

	tell application "Music"
		activate
		set thePlaylist to missing value
		if playlistPID is not "" then
			try
				set thePlaylist to (first user playlist whose persistent ID is playlistPID)
			end try
		end if
		if thePlaylist is missing value then
			try
				set thePlaylist to (first user playlist whose name is playlistName)
			end try
		end if
		if thePlaylist is missing value then return "err:not_found"
		reveal thePlaylist
		return "ok:revealed"
	end tell
end run
