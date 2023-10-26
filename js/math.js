
// // Minkowski metric
// const nu = nj.array([[-1, 0, 0], [0, 1, 0], [0, 0, 1]]);

function inverse_diag3(m) {
	return nj.array([
		[1 / m.get(0,0), 0, 0],
		[0, 1 / m.get(1,1), 0],
		[0, 0, 1 / m.get(2,2)]]);
}

// Lorentz boost
function boost(u) {
	const fac = (u.get(0) - 1.0) / (u.get(1)*u.get(1) + u.get(2)*u.get(2));
	return nj.array([
		[u.get(0), -u.get(1), -u.get(2)],
		[-u.get(1), 1.0 + fac * u.get(1)*u.get(1), fac * u.get(1)*u.get(2)],
		[-u.get(2), fac * u.get(1)*u.get(2), 1.0 + fac * u.get(2)*u.get(2)],
  ]);
}

export function neg_u(u) {
	return nj.array([u.get(0), -u.get(1), -u.get(2)]);
}

// assuming diagonal metric.T
export function general_boost(Tx, u) {
  return inverse_diag3(Tx).dot(boost(Tx.dot(u))).dot(Tx);
}

// Geodesic ODE arount x0, solving for [v^mu, x^mu] 6-vector
export const geo_f = (metric, accel_rest) => (xu) => {
  const x = xu.slice([0, 3]), u = xu.slice([3, 6]);
  var accel;
  if (accel_rest != undefined)
    accel = general_boost(metric.T(x), neg_u(u)).dot(accel_rest);
  else
  accel = nj.array([0,0,0]);
  return nj.array([
    u.get(0),
    u.get(1),
    u.get(2),
    -metric.Gamma0(x).dot(u).dot(u).get(0) + accel.get(0),
    -metric.Gamma1(x).dot(u).dot(u).get(0) + accel.get(1),
    -metric.Gamma2(x).dot(u).dot(u).get(0) + accel.get(2),
  ]);
}

export const rk4 = (f, y, h) => {
  const k1 = f(y);
  const k2 = f(y.add(k1.multiply(h/2)));
  const k3 = f(y.add(k2.multiply(h/2)));
  const k4 = f(y.add(k3.multiply(h)));
  return y.add(k1.add(k2.multiply(2)).add(k3.multiply(2)).add(k4).multiply((h / 6)));
}

export function inverse2(m) {
  var [[a, b], [c, d]] = m.tolist();
  return nj.array([[d, -b], [-c, a]]).divide(a * d - b * c);
}
