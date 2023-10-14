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

Black hole:

- [x] Schwarzschield metric for observer
- [x] Schwarzschield metric for light
- [ ] Orbiting around a black hole
- [ ] Use a precise solver
- [ ] Traversable event horizon
- [ ] Redshift
- [ ] Light attenuation

Test objects, interaction:

- [ ] Display objects
- [ ] Compute object trajectories
- [ ] Interactive spaceship control
- [ ] Interactive object spawning
- [ ] Time controls
- [ ] Scenario presets
- [ ] Automatically generate floaters

## Acknowledgements

I learned general theory of relativity from online lectures by Prof. Petr Kulhánek from CTU in Prague. Many thanks to him for skillfully balancing simplicity and completeness. [[youtube]](https://www.youtube.com/playlist?list=PLYYRBJzen2aCH6Mipd2zGG01MRVQZQ_V2) [[pdf]](http://www.aldebaran.cz/studium/otr.pdf)

Amazing WebGL code and HTML template from Mr.doob was used as the basis of this project.
