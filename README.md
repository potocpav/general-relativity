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
- [x] Refactor to use classes & files
- [x] Link to GitHub
- [ ] Improve menus

Raytracing:

- [x] Minkowski metric
- [x] Observer motion
- [x] Geodesics in polar coordinates in Minkowski metric
- [x] Raytracing in curved coordinates
- [x] Fix Lorentz Boost with non-orthonormal local coords
- [x] Gravitational redshift
- [x] Doppler redshift
- [x] Object redshift
- [x] Light attenuation
- [x] Relativistic beaming
- [x] Object relativistic beaming
- [ ] Correct redshift visualization
- [ ] HDR
- [ ] Bloom

Black hole:

- [x] Schwarzschild metric for observer
- [x] Schwarzschild metric for light
- [x] Use a precise solver for photons
- [x] Use a precise solver for motion
- [x] Orbiting around a black hole test
- [ ] Traversable event horizon

Test objects, interaction:

- [x] Display objects
- [x] Object dynamics
- [x] Correct length contractions for objects
- [x] Compute object trajectories
- [x] Interactive spaceship control
- [x] Interactive object spawning
- [ ] Time controls
- [ ] Control effects (redshift, beaming, etc.)
- [ ] Scenario presets
- [ ] Automatically generate floaters
- [ ] Spatial indexing of object trajectories to improve performance of multiple objects

Scenario ideas:

- Twin paradox
- Gravitational time dilation
- Light clocks
- Light curving around massive objects
- Falling into black hole, trying to fight gravity
- Visiting a planet close to supermassive BH
- Relativistic beaming & redshift (semaphore?)
- Objects falling into BH, accretion disc
- Expanding space-time?
- Gaining energy from Kerr hole

## Acknowledgements

I learned general theory of relativity from online lectures by Prof. Petr Kulhánek from CTU in Prague. Many thanks to him for skillfully balancing simplicity and completeness. [[youtube]](https://www.youtube.com/playlist?list=PLYYRBJzen2aCH6Mipd2zGG01MRVQZQ_V2) [[pdf]](http://www.aldebaran.cz/studium/otr.pdf)

Amazing WebGL code and HTML template from Mr.doob was used as the basis of this project.
