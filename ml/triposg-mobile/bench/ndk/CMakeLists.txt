cmake_minimum_required(VERSION 3.22)
project(spike_bench CXX)
set(CMAKE_CXX_STANDARD 17)
# ORT Android flavor: cpu (plain EP build) or qnn (QNN EP build). Picks the
# default AAR; an explicit -DORT_AAR=<path> always wins. Keep a separate
# build dir per flavor (see build.sh) so both binaries can coexist.
set(ORT_FLAVOR "cpu" CACHE STRING "onnxruntime Android flavor: cpu|qnn")
if(ORT_FLAVOR STREQUAL "cpu")
  set(ORT_AAR_DEFAULT
      "${CMAKE_CURRENT_SOURCE_DIR}/../../logs/spike-ndk/thirdparty/onnxruntime-android-1.22.0.aar")
elseif(ORT_FLAVOR STREQUAL "qnn")
  set(ORT_AAR_DEFAULT
      "${CMAKE_CURRENT_SOURCE_DIR}/../../logs/spike-ndk/thirdparty/onnxruntime-android-qnn-1.22.0.aar")
else()
  message(FATAL_ERROR "unknown ORT_FLAVOR=${ORT_FLAVOR} (cpu|qnn)")
endif()
# Path to the downloaded AAR (git-ignored build input). Override with
# -DORT_AAR=<path> when invoking cmake.
set(ORT_AAR "${ORT_AAR_DEFAULT}" CACHE FILEPATH "onnxruntime Android AAR")
set(ORT_DIR "${CMAKE_CURRENT_BINARY_DIR}/ort")
file(ARCHIVE_EXTRACT INPUT "${ORT_AAR}" DESTINATION "${ORT_DIR}")
add_executable(spike_bench bench.cpp)
target_include_directories(spike_bench PRIVATE "${ORT_DIR}/headers")
target_link_libraries(spike_bench
    "${ORT_DIR}/jni/${ANDROID_ABI}/libonnxruntime.so" log)
set_target_properties(spike_bench PROPERTIES
    BUILD_RPATH "$ORIGIN" INSTALL_RPATH "$ORIGIN")
# spike_chain: full-step chain over precompiled EPContext batch-1 units
# (resident|stream). Same ORT headers/libs as spike_bench.
add_executable(spike_chain chain.cpp)
target_include_directories(spike_chain PRIVATE "${ORT_DIR}/headers")
target_link_libraries(spike_chain
    "${ORT_DIR}/jni/${ANDROID_ABI}/libonnxruntime.so" log)
set_target_properties(spike_chain PROPERTIES
    BUILD_RPATH "$ORIGIN" INSTALL_RPATH "$ORIGIN")
# spike_pipeline: sampling loop over the 23 units + vae_post/vae_query,
# octree extraction, marching tetrahedra, GLB output. Embeds the portable
# C++ core (../../cpp) that Phase 3 reuses unchanged in the Expo module.
add_executable(spike_pipeline pipeline.cpp
    ../../cpp/extract.cpp ../../cpp/mcubes.cpp ../../cpp/glb_writer.cpp)
target_include_directories(spike_pipeline PRIVATE "${ORT_DIR}/headers")
target_link_libraries(spike_pipeline
    "${ORT_DIR}/jni/${ANDROID_ABI}/libonnxruntime.so" log)
set_target_properties(spike_pipeline PROPERTIES
    BUILD_RPATH "$ORIGIN" INSTALL_RPATH "$ORIGIN")
