cd models
convert -append render/asteroid/0*.png render/asteroid.png
convert -append render/rocket/0*.png render/rocket-firing/0*.png render/rocket.png
convert -append render/photon-clock/0*.png render/photon-clock.png
convert +append render/rocket.png render/asteroid.png render/photon-clock.png sprites.webp
