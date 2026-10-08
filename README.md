# Birthday Surprise — for Bhavuzzzz

Open `index.html` in a browser. No build step, no server needed.

## Structure
- `index.html`      page markup (8 scenes)
- `css/style.css`   all styling
- `js/config.js`    names, date, letter text, photos, music  <-- edit this
- `js/app.js`       all behaviour (scenes, cake cutting, confetti, sound)
- `assets/fonts`    Fraunces, Nunito, Caveat
- `assets/stickers` illustrations
- `assets/photos`   the 4 sample polaroid photos (photo1-4.webp)
- `assets/music`    put `birthday.mp3` here (not included, see below)

## Things to know
- **Music:** the original song was hosted on the builder's server, not inside the file,
  so it could not be extracted. Add your own file as `assets/music/birthday.mp3`.
- **Photos:** the memory wall shows the 4 sample photos. Replace the files in
  `assets/photos/` (or change the paths/captions in `js/config.js`).
- **Editor:** `index.html` opens as the finished surprise (`{"sent": true}` near the
  bottom). Remove that, or open `index.html#edit`, to get the "Edit" panel back.
- **Name:** the original file had "Bhavuuzz" in its builder settings but the page itself
  showed "Bhavuzzzz", so that spelling is used. Change it in `js/config.js`.
