class CustomError extends Error {
  constructor(err) {
    super(err);
  }
}
class UserError extends CustomError {
  constructor(err) {
    super(err);
    handleUserError(err);
  }
}

class PeerError extends CustomError {
  constructor(err) {
    super(err);
    handlePeerError(err);
  }
}

class AppError extends CustomError {}

const assert = (condition, msg) => {
  if (!IS_ASSERTS_ENABLED) {
    return;
  }

  if (condition) {
    return;
  }

  throw new AppError(msg);
};

const assertPeer = (condition, msg) => {
  if (condition) return;

  throw new PeerError(msg);
};

const assertUser = (condition, msg) => {
  if (condition) return;

  throw new UserError(msg);
};
