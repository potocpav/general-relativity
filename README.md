# General Relativity Playground

[by Pavel Potoček](https://potocpav.github.io/)

You can play with general relativity [here](https://potocpav.github.io/general-relativity/).

## Run

```sh
npx browser-sync start --server
```

## Test

```sh
npm test
```

Runs `test/index.html` in headless Chromium (set `$CHROME` if it isn't found automatically).
The page can also be opened directly in a browser via the dev server.

The physics is implemented twice: in JS (`js/metric.js`, `js/math.js`, `js/world.js`) for the
observer and object trajectories, and in GLSL (`glsl/common.glsl`, and per metric in `glsl/metrics/`)
for raytracing.
The tests evaluate both on random inputs and check that they agree, so a change to one side
must be mirrored in the other. Constants shared with the shaders (e.g. `N_SPRITES`) are defined
in JS and injected by `js/shaders.js`.

## How it works

- [ ] Describe the architecture

Raytracing along geodesics is done inside the GLSL fragment shader
(`glsl/common.glsl`, the metric's file in `glsl/metrics/` and `glsl/surface-frag.glsl`, assembled by
`js/shaders.js`).
Each pixel traces a light ray backwards from the observer. The screen axes are the observer's
local orthonormal frame, so angles and short distances around the observer are the ones the
observer would measure. The black hole therefore appears as a shadow wedge behind it rather than
a circle, and only the near side of the photon sphere is visible; `test/` checks the shadow edges
against the analytic critical angles, including relativistic aberration.

Observer and object trajectories are computed in JS.

The Schwarzschild black hole is simulated in Gullstrand–Painlevé coordinates (`js/metric.js`,
`glsl/metrics/gp.glsl`), which are regular across the horizon: the ship and objects can fall in and
are followed until close to the singularity, and the view from inside is rendered. The grid lines
are at constant r and φ, and its redshift is computed for light emitted by "raindrop" observers,
falling freely from rest at infinity. Where coordinates break down, bodies and light rays are
stopped by checks based on local quantities only (`maxFrameCondition` in `js/metric.js`).

Light rays are traced with their
conserved energy and angular momentum, which keeps them regular at the horizon. Rays that end in
the black hole's shadow are black (dark red with "BH interior" on); from inside, that includes light that would come from the
white hole (in a real black hole, from the collapsed star). `test/` checks the inside view against
analytic results, e.g. that at the horizon the black hole covers 42° around the inward direction.

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
- [x] Adaptive RK step size for photons
- [ ] Correct redshift visualization
- [ ] HDR
- [ ] Bloom

Object dynamics:

- [x] Schwarzschild metric for observer
- [x] Schwarzschild metric for light
- [x] Use a precise solver for photons
- [x] Use a precise solver for motion
- [x] Orbiting around a black hole test
- [x] Ship orientation: Fermi–Walker transported gyroscope axis (geodetic precession)
- [x] Correct object orientation with parallel transport
- [x] Traversable event horizon

Test objects, interaction:

- [x] Display objects
- [x] Object dynamics
- [x] Correct length contractions for objects
- [x] Compute object trajectories
- [x] Interactive spaceship control
- [x] Interactive object spawning
- [x] Time controls
- [x] Control effects (redshift, beaming, etc.)
- [x] Scenario presets

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
