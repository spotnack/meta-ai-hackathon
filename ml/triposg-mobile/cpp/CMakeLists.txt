# Portable TripoSG C++ core (extract + marching tetrahedra + GLB writer).
#
# One copy, built two ways: the laptop host test (cpp/test) compiles the
# sources directly, and the Expo module (client/modules/triposg) adds
# this directory as triposg_core. No third-party dependencies.
cmake_minimum_required(VERSION 3.22)
project(triposg_core CXX)
set(CMAKE_CXX_STANDARD 17)
add_library(triposg_core STATIC
  extract.cpp
  mcubes.cpp
  glb_writer.cpp)
target_include_directories(triposg_core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")
