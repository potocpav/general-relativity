
from sympy import symbols
from einsteinpy import symbolic

# polar coordinates

t,r,phi=symbols('t,r,phi')
symbolic.metric.MetricTensor([[-1,0,0],[0,1,0],[0,0,r**2]],[t,r,phi],'ll','polar')

g=symbolic.metric.MetricTensor([[-1,0,0],[0,1,0],[0,0,r**2]],[t,r,phi],'ll','polar')
Gamma = symbolic.christoffel.ChristoffelSymbols.from_metric(g)
