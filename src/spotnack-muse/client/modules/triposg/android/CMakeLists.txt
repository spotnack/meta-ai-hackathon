# JNI lib over the shared C++ engine.
#
# Sources: ../cpp (module-owned engine: pipeline/preprocess/decimate/
# models) + the one shared core copy at ml/triposg-mobile/cpp (added as
# triposg_core; never forked) + meshoptimizer (vendored, MIT) + the JNI
# bridge in src/main/cpp. ORT headers/lib come from the AAR extracted by
# Gradle (ORT_AAR_DIR).
cmake_minimum_required(VERSION 3.22)
project(triposg_jni CXX)
set(CMAKE_CXX_STANDARD 17)

set(ORT_AAR_DIR "" CACHE PATH "ORT AAR extract dir (headers/ + jni/)")
if(NOT EXISTS "${ORT_AAR_DIR}/headers/onnxruntime_cxx_api.h")
  message(FATAL_ERROR "missing ORT headers in ${ORT_AAR_DIR} "
    "(Gradle extractOrtAar should fill it)")
endif()

# One shared core copy: ml/triposg-mobile/cpp (6 levels up from android/).
add_subdirectory(
  ../../../../../../ml/triposg-mobile/cpp
  "${CMAKE_CURRENT_BINARY_DIR}/triposg_core_build")

set(MESHOPT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../cpp/third_party/meshoptimizer")
if(NOT EXISTS "${MESHOPT_DIR}/meshoptimizer.h")
  message(FATAL_ERROR "missing vendored meshoptimizer in ${MESHOPT_DIR}: "
    "fetch meshoptimizer.h, simplifier.cpp, indexgenerator.cpp, "
    "indexgenerator.h and LICENSE.md at the pinned version (see "
    "cpp/third_party/meshoptimizer/README.md)")
endif()

add_library(triposg_jni SHARED
  ../cpp/pipeline.cpp
  ../cpp/preprocess.cpp
  ../cpp/decimate.cpp
  ../cpp/models.cpp
  "${MESHOPT_DIR}/simplifier.cpp"
  "${MESHOPT_DIR}/indexgenerator.cpp"
  src/main/cpp/jni_bridge.cpp)
target_include_directories(triposg_jni PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/../cpp"
  "${MESHOPT_DIR}"
  "${ORT_AAR_DIR}/headers")
target_link_libraries(triposg_jni
  triposg_core
  "${ORT_AAR_DIR}/jni/${ANDROID_ABI}/libonnxruntime.so"
  log)
