cd models
convert -append render/asteroid/0*.png render/asteroid.png
convert -append render/rocket/0*.png render/rocket-firing/0*.png render/rocket.png
convert +append render/asteroid.png render/rocket.png sprites.webp
