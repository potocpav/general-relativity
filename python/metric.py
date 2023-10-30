
import numpy as np
from sympy import symbols
from sympy import *
from einsteinpy import symbolic

# simplify element-wise. Didn't find a simpler pattern to do the same.
def simplify(gamma):
  # return simplify(Matrix(g.arr.tolist()))
  return np.array([[[gamma[k][j][i].simplify() for i in [0,1,2]] for j in [0,1,2]] for k in [0,1,2]]);

print("-- Polar coordinates")

t, r, phi = symbols('t,r,phi')
g = symbolic.metric.MetricTensor([[-1,0,0],[0,1,0],[0,0,r**2]],[t,r,phi],'ll','polar')
Gamma = symbolic.christoffel.ChristoffelSymbols.from_metric(g)

print(g)
print(Gamma)

print("--------------------------------")

print("-- Schwarzschild Christoffel symbols")

rs = symbols('rs')
t, r, phi = symbols('t,r,phi')
g = symbolic.metric.MetricTensor([[-(1 - rs / r),0,0],[0,1 / (1 - rs/r),0],[0,0,r**2]],[t,r,phi],'ll','schwarzschild')
Gamma = symbolic.christoffel.ChristoffelSymbols.from_metric(g)
print(simplify(Gamma))

print("-- Schwarzschild Eigenvalues")

print(Matrix(g.arr.tolist()).eigenvals())


print("--------------------------------")

print("-- Gullstrand-Painleve coordinates for the Schwarzschild metric")

rs = symbols('rs')
t, r, phi = symbols('t,r,phi')
g = symbolic.metric.MetricTensor([
  [-(1-rs/r),-sqrt(rs/r),0],
  [-sqrt(rs/r),1,0],
  [0,0,r**2]],
  [t,r,phi],'ll','gp-schwarzschild')
Gamma = symbolic.christoffel.ChristoffelSymbols.from_metric(g)
print(simplify(Gamma))
