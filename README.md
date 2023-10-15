# General Relativity Playground

You can play with general relativity [here](https://potocpav.github.io/general-relativity/).

## Run

```sh
npx browser-sync start --server
```

## Plan

Infra:

- [x] Find a basis project, clone & adapt it
- [x] Publish to GH Pages
- [ ] Link to GitHub
- [ ] Improve menus

Raytracing:

- [x] Minkowski metric
- [x] Observer motion
- [x] Geodesics in polar coordinates in Minkowski metric
- [x] Raytracing in curved coordinates
- [x] Fix Lorentz Boost with non-orthonormal local coords
- [x] Gravitational redshift
- [ ] Doppler redshift
- [ ] Object redshift
- [ ] Correct redshift visualization
- [ ] Light attenuation
- [ ] Relativistic beaming
- [ ] Object relativistic beaming

Black hole:

- [x] Schwarzschield metric for observer
- [x] Schwarzschield metric for light
- [x] Use a precise solver for photons
- [x] Use a precise solver for motion
- [x] Orbiting around a black hole test
- [ ] Traversable event horizon

Test objects, interaction:

- [ ] Display objects
- [ ] Compute object trajectories
- [ ] Interactive spaceship control
- [ ] Interactive object spawning
- [ ] Time controls
- [ ] Control effects (redshift, beaming, etc.)
- [ ] Scenario presets
- [ ] Automatically generate floaters

## Acknowledgements

I learned general theory of relativity from online lectures by Prof. Petr Kulhánek from CTU in Prague. Many thanks to him for skillfully balancing simplicity and completeness. [[youtube]](https://www.youtube.com/playlist?list=PLYYRBJzen2aCH6Mipd2zGG01MRVQZQ_V2) [[pdf]](http://www.aldebaran.cz/studium/otr.pdf)

Amazing WebGL code and HTML template from Mr.doob was used as the basis of this project.
