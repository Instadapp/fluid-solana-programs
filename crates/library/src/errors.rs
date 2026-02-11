use anchor_lang::prelude::*;

pub type FluidResult<T = ()> = std::result::Result<T, ErrorCodes>;

#[error_code]
pub enum ErrorCodes {
    #[msg(LIBRARY_MATH_ERROR)]
    LibraryMathError,

    #[msg(LIBRARY_CASTING_ERROR)]
    LibraryCastingFailure,

    #[msg(LIBRARY_BN_ERROR)]
    LibraryBnError,

    #[msg(LIBRARY_DIVISION_BY_ZERO)]
    LibraryDivisionByZero,

    #[msg(LIBRARY_TICK_OUT_OF_BOUNDS)]
    LibraryTickOutOfBounds,

    #[msg(LIBRARY_TICK_RATIO_OUT_OF_BOUNDS)]
    LibraryTickRatioOutOfBounds,

    #[msg(LIBRARY_TICK_DIVISION_BY_ZERO)]
    LibraryTickDivisionByZero,

    #[msg(LIBRARY_TICK_OVERFLOW)]
    LibraryTickOverflow,

    #[msg(LIBRARY_TICK_INVALID_PERFECT_RATIO)]
    LibraryTickInvalidPerfectRatio,

    #[msg(LIBRARY_U256_NUMBER_DOWN_CAST_ERROR)]
    LibraryU256NumberDownCastError,

    #[msg(LIBRARY_INVALID_TOKEN_ACCOUNT)]
    LibraryInvalidTokenAccount,

    #[msg(LIBRARY_UNSUPPORTED_TOKEN_EXTENSION)]
    LibraryUnsupportedTokenExtension,

    #[msg(LIBRARY_INVALID_TOKEN_MINT)]
    LibraryInvalidTokenMint,
}
