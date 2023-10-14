
from sympy import symbols
from sympy import *
from einsteinpy import symbolic

print("-- Polar coordinates")

t, r, phi = symbols('t,r,phi')
g = symbolic.metric.MetricTensor([[-1,0,0],[0,1,0],[0,0,r**2]],[t,r,phi],'ll','polar')
Gamma = symbolic.christoffel.ChristoffelSymbols.from_metric(g)

print(g)
print(Gamma)

print("--------------------------------")

print("-- Schwarzschield metric")

rs = symbols('rs')
t, r, phi = symbols('t,r,phi')
g = symbolic.metric.MetricTensor([[-(1 - rs / r),0,0],[0,1 / (1 - rs/r),0],[0,0,r**2]],[t,r,phi],'ll','schwarzschield')
Gamma = symbolic.christoffel.ChristoffelSymbols.from_metric(g)

# print(g.applyfunc(simplify))
print(Gamma.arr())
