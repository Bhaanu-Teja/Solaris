-- ============================================================
--  SOLARIS — Heliometric Intelligence Platform
--  Paths_solar_server.hs
--  Cabal-generated path utilities for data and binary files
-- ============================================================

{-# LANGUAGE CPP #-}
{-# LANGUAGE NoRebindableSyntax #-}

#ifndef MIN_VERSION_base
#define MIN_VERSION_base(x,y,z) 1
#endif

module Paths_solar_server (
    version,
    getBinDir,
    getLibDir,
    getDynLibDir,
    getDataDir,
    getLibexecDir,
    getDataFileName,
    getSysconfDir
) where

import Control.Exception as Exception
import Data.Version      (Version(..))
import System.Environment (getEnv)
import Prelude

#if defined(VERSION_base)
#if MIN_VERSION_base(4,0,0)
catchIO :: IO a -> (Exception.IOException -> IO a) -> IO a
#else
catchIO :: IO a -> (Exception.Exception -> IO a) -> IO a
#endif
#else
catchIO :: IO a -> (Exception.IOException -> IO a) -> IO a
#endif
catchIO = Exception.catch

-- | Full package version
version :: Version
version = Version [0, 1, 0, 0] []

-- | Get the installation bin directory
getBinDir :: IO FilePath
getBinDir = catchIO (getEnv "solar_server_bindir") (\_ -> return bindir)

-- | Get the installation lib directory
getLibDir :: IO FilePath
getLibDir = catchIO (getEnv "solar_server_libdir") (\_ -> return libdir)

-- | Get the installation dynlib directory
getDynLibDir :: IO FilePath
getDynLibDir = catchIO (getEnv "solar_server_dynlibdir") (\_ -> return dynlibdir)

-- | Get the installation data directory
getDataDir :: IO FilePath
getDataDir = catchIO (getEnv "solar_server_datadir") (\_ -> return datadir)

-- | Get the installation libexec directory
getLibexecDir :: IO FilePath
getLibexecDir = catchIO (getEnv "solar_server_libexecdir") (\_ -> return libexecdir)

-- | Get a data file path
getDataFileName :: FilePath -> IO FilePath
getDataFileName name = do
    dir <- getDataDir
    return (dir ++ "/" ++ name)

-- | Get the installation sysconfdir
getSysconfDir :: IO FilePath
getSysconfDir = catchIO (getEnv "solar_server_sysconfdir") (\_ -> return sysconfdir)

-- ── Compiled-in paths (substituted by Cabal during build) ──

bindir, libdir, dynlibdir, datadir, libexecdir, sysconfdir :: FilePath

bindir     = "/usr/local/bin"
libdir     = "/usr/local/lib/solar-server-0.1.0.0/ghc-9.6.7"
dynlibdir  = "/usr/local/lib/x86_64-linux-ghc-9.6.7"
datadir    = "/usr/local/share/solar-server-0.1.0.0"
libexecdir = "/usr/local/libexec/solar-server-0.1.0.0/ghc-9.6.7"
sysconfdir = "/usr/local/etc"
