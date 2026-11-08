# Laptop host test for the portable C++ core (extract + mcubes + glb).
#
# Builds test_vae_decode against:
#   - ORT C++ headers extracted from the 1.22.0 Android AAR (the C API is
#     platform-independent; version must match the lib below), and
#   - libonnxruntime.so.1.22.0 from the triposg-spike pip install (CPU).
# Both default locations are overridable for other machines:
#   cmake -S ml/triposg-mobile/cpp/test -B <build> \
#     -DORT_AAR_122=<path> -DORT_LIB=<libonnxruntime.so> \
#     -DORT_INCLUDE_DIR=<headers>   # skips the AAR extract
cmake_minimum_required(VERSION 3.22)
project(triposg_cpp_test CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_BUILD_TYPE Release)

find_package(Python3 REQUIRED COMPONENTS Interpreter)

set(ORT_AAR_122
    "${CMAKE_CURRENT_SOURCE_DIR}/../../logs/spike-ndk/thirdparty/onnxruntime-android-1.22.0.aar"
    CACHE FILEPATH "1.22.0 AAR we take the C API headers from")
set(ORT_LIB "" CACHE FILEPATH "libonnxruntime.so for the laptop (default: pip wheel)")
set(ORT_INCLUDE_DIR "" CACHE PATH "ORT headers dir (default: extracted from ORT_AAR_122)")

if(ORT_INCLUDE_DIR STREQUAL "")
  if(NOT EXISTS "${ORT_AAR_122}")
    message(FATAL_ERROR "missing ${ORT_AAR_122} (override with -DORT_AAR_122=)")
  endif()
  set(ORT_EXDIR "${CMAKE_CURRENT_BINARY_DIR}/ort-aar")
  file(ARCHIVE_EXTRACT INPUT "${ORT_AAR_122}" DESTINATION "${ORT_EXDIR}")
  set(ORT_INCLUDE_DIR "${ORT_EXDIR}/headers")
endif()

if(ORT_LIB STREQUAL "")
  execute_process(
    COMMAND "${Python3_EXECUTABLE}" -c
      "import sysconfig, os; print(os.path.join(sysconfig.get_path('purelib'), 'onnxruntime', 'capi'))"
    OUTPUT_VARIABLE ORT_CAPI OUTPUT_STRIP_TRAILING_WHITESPACE)
  set(ORT_LIB "${ORT_CAPI}/libonnxruntime.so.1.22.0")
endif()
if(NOT EXISTS "${ORT_LIB}")
  message(FATAL_ERROR "missing ${ORT_LIB} (override with -DORT_LIB=)")
endif()
if(NOT EXISTS "${ORT_INCLUDE_DIR}/onnxruntime_cxx_api.h")
  message(FATAL_ERROR "missing headers in ${ORT_INCLUDE_DIR}")
endif()
get_filename_component(ORT_LIBDIR "${ORT_LIB}" DIRECTORY)

add_executable(test_vae_decode
  test_vae_decode.cpp
  ../extract.cpp
  ../mcubes.cpp
  ../glb_writer.cpp)
target_include_directories(test_vae_decode PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/.." "${ORT_INCLUDE_DIR}")
target_link_libraries(test_vae_decode PRIVATE "${ORT_LIB}")
set_target_properties(test_vae_decode PROPERTIES BUILD_RPATH "${ORT_LIBDIR}")

# test_preprocess: front-end parity (bg removal + prepare + DINOv2
# preprocessing). Compiles the module's own preprocess.cpp — the one
# copy, referenced here by relative path, never forked.
set(MODULE_CPP
  "${CMAKE_CURRENT_SOURCE_DIR}/../../../../src/spotnack-muse/client/modules/triposg/cpp")
add_executable(test_preprocess
  test_preprocess.cpp
  "${MODULE_CPP}/preprocess.cpp")
target_include_directories(test_preprocess PRIVATE
  "${MODULE_CPP}" "${ORT_INCLUDE_DIR}")
target_link_libraries(test_preprocess PRIVATE "${ORT_LIB}")
set_target_properties(test_preprocess PROPERTIES BUILD_RPATH "${ORT_LIBDIR}")

# primitives_probe: CLI over the exact-port primitives (no ORT needed;
# preprocess.cpp is dependency-free). Graded bit-exactly by
# check_primitives.py.
add_executable(primitives_probe
  primitives_probe.cpp
  "${MODULE_CPP}/preprocess.cpp")
target_include_directories(primitives_probe PRIVATE "${MODULE_CPP}")
