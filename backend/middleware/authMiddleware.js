const jwt = require('jsonwebtoken');
require('dotenv').config();

exports.auth = async (req, res, next) => {
  try {
    // Log cookies for debugging
    console.log("Cookies received:", req.cookies);

    // Token can come from cookies (preferred) or Authorization header
    const token =
      req.cookies.token || req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token missing. Please login.',
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded; // Attach user info to request
      // console.log(req.user);
      next();
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Token is invalid or expired',
      });
    }
  } catch (err) {
    console.error("Token verification error:", err);
    return res.status(500).json({
      success: false,
      message: 'Error verifying token',
    });
  }
};

exports.isFaculty = (req, res, next) => {
  try {
    if (req.user?.role !== "Faculty") {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Faculty only.',
      });
    }
    next();
  } catch (err) {
    return res.status(403).json({
      success: false,
      message: 'User role missing or invalid',
    });
  }
};

exports.isAdmin = (req, res, next) => {
  try {
    if (req.user?.role !== "Admin") {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admins only.',
      });
    }
    next();
  } catch (err) {
    return res.status(403).json({
      success: false,
      message: 'User role missing or invalid',
    });
  }
};
