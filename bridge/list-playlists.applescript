-- WaveDrop → list the user's Apple Music playlists for the target picker.
-- Usage: osascript list-playlists.applescript
-- Prints one playlist per line:  <persistentID>\t<name>\t<trackCount>
-- Folder playlists are skipped (you can't add tracks to a folder).

on run argv
	set out to ""
	tell application "Music"
		if not running then launch
		with timeout of 120 seconds
			set pls to (every user playlist)
			repeat with p in pls
				try
					set isFolder to false
					try
						if (class of p) is folder playlist then set isFolder to true
					end try
					if not isFolder then
						set pid to (get persistent ID of p)
						set nm to (get name of p)
						set cnt to (count of tracks of p)
						set out to out & pid & tab & nm & tab & (cnt as string) & linefeed
					end if
				end try
			end repeat
		end timeout
	end tell
	return out
end run
