#!/bin/sh
# Combine rendered sprite frames into the sprite atlas.
# Frames are stacked vertically (time), sprites side by side.
set -eu
cd "$(dirname "$0")"
magick render/asteroid/0*.png -append render/asteroid.png
magick render/rocket/0*.png render/rocket-firing/0*.png -append render/rocket.png
magick render/photon-clock/0*.png -append render/photon-clock.png
magick render/rocket.png render/asteroid.png render/photon-clock.png +append sprites.webp
